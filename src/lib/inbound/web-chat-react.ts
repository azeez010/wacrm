import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { resumeAwaitingReply, runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'

// ============================================================
// What reacts to a visitor's message in a website chat: the same cascade the
// WhatsApp webhook runs (flows → waiting automations → message automations →
// AI reply), made channel-aware by the senders (src/lib/channels/engine-route.ts).
// Call it from after(): it can take as long as an LLM call and never throws.
// ============================================================

export interface WebChatReaction {
  accountId: string
  contactId: string
  conversationId: string
  /** Id stored on the visitor's message (idempotency key for flows). */
  messageId: string
  text: string
  /** Set when the visitor tapped a quick-reply option. */
  replyId?: string | null
  isFirstInbound: boolean
  contactCreated: boolean
}

export type AutomationTrigger = 'new_contact_created' | 'first_inbound_message' | 'new_message_received' | 'keyword_match' | 'interactive_reply'

/** The automation triggers for one inbound, in firing order. Pure. */
export function automationTriggersFor(opts: { contentConsumed: boolean; replyId?: string | null; isFirstInbound: boolean; contactCreated: boolean }): AutomationTrigger[] {
  const t: AutomationTrigger[] = []
  if (!opts.contentConsumed) {
    t.push('new_message_received', 'keyword_match')
    if (opts.replyId) t.push('interactive_reply')
  }
  if (opts.contactCreated) t.unshift('new_contact_created')
  if (opts.isFirstInbound) t.unshift('first_inbound_message')
  return t
}

export async function reactToWebChatMessage(db: SupabaseClient, r: WebChatReaction): Promise<void> {
  try {
    const ownerUserId = await resolveAuditUserId(db, r.accountId)

    const flow = await dispatchInboundToFlows({
      accountId: r.accountId,
      userId: ownerUserId,
      contactId: r.contactId,
      conversationId: r.conversationId,
      message: r.replyId
        ? { kind: 'interactive_reply', reply_id: r.replyId, reply_title: r.text, meta_message_id: r.messageId }
        : { kind: 'text', text: r.text, meta_message_id: r.messageId },
      isFirstInboundMessage: r.isFirstInbound,
    })

    const automationConsumed = flow.consumed
      ? false
      : await resumeAwaitingReply({
          accountId: r.accountId,
          contactId: r.contactId,
          context: { message_text: r.text, conversation_id: r.conversationId, interactive_reply_id: r.replyId ?? undefined },
        })
    const contentConsumed = flow.consumed || automationConsumed

    for (const triggerType of automationTriggersFor({ contentConsumed, replyId: r.replyId, isFirstInbound: r.isFirstInbound, contactCreated: r.contactCreated })) {
      await runAutomationsForTrigger({
        accountId: r.accountId,
        triggerType,
        contactId: r.contactId,
        context: { message_text: r.text, conversation_id: r.conversationId, interactive_reply_id: r.replyId ?? undefined },
      }).catch((err) => console.error('[web-chat] automation dispatch failed:', err))
    }

    if (!contentConsumed && !r.replyId && r.text.trim()) {
      await dispatchInboundToAiReply({
        accountId: r.accountId,
        conversationId: r.conversationId,
        contactId: r.contactId,
        configOwnerUserId: ownerUserId,
        inboundMessageId: r.messageId,
      })
    }
  } catch (err) {
    console.error('[web-chat] reactions failed:', err instanceof Error ? err.message : err)
  }
}
