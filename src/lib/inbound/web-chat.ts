import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { isBlocked } from '@/lib/contacts/block-guard'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { claimFirstInboundMessage } from '@/lib/conversations/first-inbound'
import { reopenClosedConversation } from '@/lib/conversations/reopen'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils'
import { CHAT_MESSAGE_COLUMNS, toChatMessageView, type ChatMessageRow } from '@/lib/chat/message-view'
import { pushToRoom } from '@/lib/chat/room'
import type { ChatMessageView } from '@/lib/chat/protocol'

// ============================================================
// Inbound path for website live chat (the web twin of the WhatsApp webhook's
// processMessage). Finds or creates the visitor's contact and their
// `web_chat` conversation, stores the message, bumps the thread and announces
// it. Everything runs through the service-role client with the account
// resolved from the widget, never from anything the visitor sends.
//
// Flows, automations and AI replies are not dispatched from here yet: their
// senders talk to Meta directly and must become channel-aware first (sending
// to a visitor's typed phone number over WhatsApp would be a bug).
// ============================================================

export interface VisitorDetails {
  visitorId: string
  name?: string | null
  /** International format with a leading +. */
  phone?: string | null
  email?: string | null
}

export interface ChatWidgetRef {
  formId: string
  formName: string
  accountId: string
}

export interface VisitorThread {
  contactId: string
  contactCreated: boolean
  conversationId: string
  conversationCreated: boolean
}

const cleanText = (v: string | null | undefined, max: number): string | null => {
  const t = (v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
  return t || null
}

interface KnownContact {
  id: string
  name?: string | null
  email?: string | null
  phone?: string | null
}

const PLACEHOLDER_NAME = 'Website visitor'

/**
 * Details typed into the chat for a contact that already exists (a returning browser). Only
 * fills what is missing or a placeholder, so an agent's edits and earlier answers are never
 * overwritten by whoever later uses the same browser.
 */
async function applyVisitorDetails(db: SupabaseClient, widget: ChatWidgetRef, known: KnownContact, visitor: VisitorDetails, ownerUserId: string) {
  const name = cleanText(visitor.name, 120)
  const email = cleanText(visitor.email, 200)
  const phone = visitor.phone ? parseInternationalPhone(visitor.phone) : null
  if (!name && !email && !phone) return

  const patch: Record<string, string> = {}
  const currentName = (known.name ?? '').trim()
  const placeholder = !currentName || currentName === PLACEHOLDER_NAME || currentName === (known.phone ?? '') || currentName === (known.email ?? '')
  if (name && placeholder) patch.name = name
  if (email && !known.email) patch.email = email
  let collision = false
  if (phone && !known.phone) {
    const other = await findExistingContact(db, widget.accountId, phone)
    if (other && other.id !== known.id) collision = true
    else patch.phone = phone
  }
  if (!name && placeholder && patch.email) patch.name = patch.email
  if (Object.keys(patch).length > 0) {
    const { error } = await db.from('contacts').update(patch).eq('id', known.id).eq('account_id', widget.accountId)
    if (error) console.error('[web-chat] contact update failed:', error.message)
  }
  if (collision && phone) {
    await db.from('contact_notes').insert({
      account_id: widget.accountId,
      contact_id: known.id,
      user_id: ownerUserId,
      note_text: `This website visitor gave the number ${phone}, which already belongs to another contact. Not merged automatically.`,
    })
  }
}

/** Find the visitor's contact (by visitor id) or create / claim one. */
async function resolveVisitorContact(
  db: SupabaseClient,
  widget: ChatWidgetRef,
  visitor: VisitorDetails,
  ownerUserId: string,
): Promise<{ id: string; created: boolean }> {
  const accountId = widget.accountId
  const byVisitor = await db
    .from('contacts')
    .select('id, name, email, phone')
    .eq('account_id', accountId)
    .eq('web_visitor_id', visitor.visitorId)
    .maybeSingle()
  if (byVisitor.data) {
    // A returning visitor (same browser) who now gave details: put them on their contact.
    await applyVisitorDetails(db, widget, byVisitor.data as KnownContact, visitor, ownerUserId)
    return { id: (byVisitor.data as KnownContact).id, created: false }
  }

  const name = cleanText(visitor.name, 120)
  const email = cleanText(visitor.email, 200)
  const phone = visitor.phone ? parseInternationalPhone(visitor.phone) : null

  // A phone the visitor typed may belong to an existing contact. Claiming it is
  // the same trust level as a lead form, but only while that contact has no
  // website thread of its own, so a stranger can never land inside someone
  // else's earlier chat.
  let collidedWith: string | null = null
  if (phone) {
    const existing = await findExistingContact(db, accountId, phone)
    if (existing) {
      const [{ data: webThread }, current] = await Promise.all([
        db.from('conversations').select('id').eq('account_id', accountId).eq('contact_id', existing.id).eq('channel', 'web_chat').limit(1),
        db.from('contacts').select('web_visitor_id').eq('id', existing.id).maybeSingle(),
      ])
      const free = (webThread?.length ?? 0) === 0 && !(current.data as { web_visitor_id?: string | null } | null)?.web_visitor_id
      if (free) {
        const { error } = await db
          .from('contacts')
          .update({ web_visitor_id: visitor.visitorId })
          .eq('id', existing.id)
          .eq('account_id', accountId)
          .is('web_visitor_id', null)
        if (!error) return { id: existing.id, created: false }
      }
      collidedWith = existing.id
    }
  }

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      // A collision keeps the number off the new record (it is unique per account).
      phone: phone && !collidedWith ? phone : '',
      name: name ?? email ?? (phone && !collidedWith ? phone : 'Website visitor'),
      email,
      web_visitor_id: visitor.visitorId,
      lead_source: `Live chat: ${widget.formName}`.slice(0, 200),
      source_form_id: widget.formId,
      first_seen_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error || !created) {
    if (isUniqueViolation(error)) {
      const raced = await db.from('contacts').select('id').eq('account_id', accountId).eq('web_visitor_id', visitor.visitorId).maybeSingle()
      if (raced.data) return { id: raced.data.id as string, created: false }
    }
    throw new Error(`contact create failed: ${error?.message ?? 'unknown'}`)
  }

  if (collidedWith && phone) {
    await db.from('contact_notes').insert({
      account_id: accountId,
      contact_id: created.id,
      user_id: ownerUserId,
      note_text: `This website visitor gave the number ${phone}, which already belongs to another contact. Not merged automatically.`,
    })
  }
  return { id: created.id as string, created: true }
}

/** Find or create the visitor's website thread. */
async function resolveWebConversation(
  db: SupabaseClient,
  widget: ChatWidgetRef,
  contactId: string,
  ownerUserId: string,
): Promise<{ id: string; created: boolean; status: string | null; first_inbound_at: string | null }> {
  const select = 'id, status, first_inbound_at'
  const find = () =>
    db.from('conversations').select(select).eq('account_id', widget.accountId).eq('contact_id', contactId).eq('channel', 'web_chat').order('created_at', { ascending: true }).limit(1)

  const found = await find()
  const row = (found.data as { id: string; status: string | null; first_inbound_at: string | null }[] | null)?.[0]
  if (row) return { ...row, created: false }

  const { data: created, error } = await db
    .from('conversations')
    .insert({ account_id: widget.accountId, user_id: ownerUserId, contact_id: contactId, channel: 'web_chat', form_id: widget.formId })
    .select(select)
    .single()
  if (error || !created) {
    if (isUniqueViolation(error)) {
      const raced = (await find()).data as { id: string; status: string | null; first_inbound_at: string | null }[] | null
      if (raced?.[0]) return { ...raced[0], created: false }
    }
    throw new Error(`conversation create failed: ${error?.message ?? 'unknown'}`)
  }
  return { ...(created as { id: string; status: string | null; first_inbound_at: string | null }), created: true }
}

export async function openVisitorThread(
  db: SupabaseClient,
  widget: ChatWidgetRef,
  visitor: VisitorDetails,
): Promise<VisitorThread & { ownerUserId: string }> {
  const ownerUserId = await resolveAuditUserId(db, widget.accountId)
  const contact = await resolveVisitorContact(db, widget, visitor, ownerUserId)
  const conversation = await resolveWebConversation(db, widget, contact.id, ownerUserId)
  if (conversation.created) {
    await dispatchWebhookEvent(db, widget.accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contact.id,
      channel: 'web_chat',
    })
  }
  return {
    contactId: contact.id,
    contactCreated: contact.created,
    conversationId: conversation.id,
    conversationCreated: conversation.created,
    ownerUserId,
  }
}

export interface InboundContent {
  text?: string | null
  /** Public URL of an already stored image (see storeVisitorImage). */
  imageUrl?: string | null
  imageMime?: string | null
  /** Client-generated id, so a retried send does not create a second message. */
  clientId?: string | null
}

export interface InboundResult {
  message: ChatMessageView
  duplicate: boolean
}

/**
 * Store a visitor message in a web_chat conversation and announce it.
 * `conversation` must already be verified to belong to `accountId`.
 */
export async function recordVisitorMessage(
  db: SupabaseClient,
  args: { accountId: string; contactId: string; conversationId: string; content: InboundContent; announceNew?: { widgetName: string; label: string } },
): Promise<InboundResult> {
  const { accountId, contactId, conversationId, content } = args
  const text = cleanText(content.text, 4000)
  const isImage = !!content.imageUrl
  if (!text && !isImage) throw new Error('empty message')

  const receivedAt = new Date().toISOString()
  const clientId = content.clientId && /^[A-Za-z0-9_-]{8,64}$/.test(content.clientId) ? `web:${content.clientId}` : null

  const row = {
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: isImage ? 'image' : 'text',
    content_text: text,
    media_url: isImage ? content.imageUrl : null,
    media_type: isImage ? (content.imageMime ?? null) : null,
    message_id: clientId,
  }
  const inserted = clientId
    ? await db.from('messages').upsert(row, { onConflict: 'conversation_id,message_id', ignoreDuplicates: true }).select(CHAT_MESSAGE_COLUMNS)
    : await db.from('messages').insert(row).select(CHAT_MESSAGE_COLUMNS)
  if (inserted.error) throw new Error(`message insert failed: ${inserted.error.message}`)

  const stored = (inserted.data as ChatMessageRow[] | null)?.[0]
  if (!stored && clientId) {
    // Replay of a send we already stored: hand back the original, do nothing else.
    const { data: prior } = await db.from('messages').select(CHAT_MESSAGE_COLUMNS).eq('conversation_id', conversationId).eq('message_id', clientId).maybeSingle()
    if (prior) return { message: toChatMessageView(prior as ChatMessageRow), duplicate: true }
    throw new Error('message insert returned no row')
  }
  if (!stored) throw new Error('message insert returned no row')

  const { data: conv } = await db.from('conversations').select('id, status, first_inbound_at').eq('id', conversationId).maybeSingle()
  const conversation = (conv as { id: string; status: string | null; first_inbound_at: string | null } | null) ?? { id: conversationId, status: null, first_inbound_at: null }
  await claimFirstInboundMessage(db, conversation, receivedAt)
  const { error: bumpErr } = await db.rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversationId,
    p_last_message_text: text ?? '[image]',
  })
  if (bumpErr) console.error('[web-chat] bump failed:', bumpErr.message)
  await reopenClosedConversation(db, conversation)

  const view = toChatMessageView(stored)
  await pushToRoom(conversationId, { type: 'message', message: view }, 'all')

  if (args.announceNew) await notifyTeam(db, accountId, contactId, conversationId, args.announceNew.label, text ?? '[image]')

  // A blocked contact's message is stored and visible, but nothing reacts to it.
  const { data: blockedRow } = await db.from('contacts').select('blocked_at').eq('id', contactId).eq('account_id', accountId).maybeSingle()
  if (!isBlocked(blockedRow)) {
    await dispatchWebhookEvent(db, accountId, 'message.received', {
      conversation_id: conversationId,
      contact_id: contactId,
      channel: 'web_chat',
      content_type: stored.content_type,
      text,
    })
  }
  return { message: view, duplicate: false }
}

/** One in-app notification per teammate who handles conversations, when a chat begins. */
async function notifyTeam(db: SupabaseClient, accountId: string, contactId: string, conversationId: string, label: string, preview: string) {
  try {
    const { data } = await db.from('profiles').select('user_id').eq('account_id', accountId).in('account_role', ['owner', 'admin', 'agent'])
    const ids = ((data ?? []) as { user_id: string }[]).map((r) => r.user_id)
    if (ids.length === 0) return
    await db.from('notifications').insert(
      ids.map((user_id) => ({
        account_id: accountId,
        user_id,
        type: 'form_submission',
        contact_id: contactId,
        conversation_id: conversationId,
        title: `New chat: ${label}`.slice(0, 200),
        body: preview.slice(0, 200),
      })),
    )
  } catch (err) {
    console.error('[web-chat] notify failed:', err instanceof Error ? err.message : err)
  }
}
