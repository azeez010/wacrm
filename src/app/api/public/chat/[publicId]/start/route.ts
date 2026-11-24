import { z } from 'zod'

import { chatJson, chatPreflight, loadChatForm } from '@/lib/chat/http'
import { chatSecret } from '@/lib/chat/secret'
import { CHAT_MESSAGE_COLUMNS, loadSenderNames, toChatMessageView, type ChatMessageRow } from '@/lib/chat/message-view'
import { signChatToken, VISITOR_TOKEN_TTL_S } from '@/lib/chat/token'
import { getLimit } from '@/lib/billing/entitlements'
import { getClientIp, checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { openVisitorThread, recordVisitorMessage } from '@/lib/inbound/web-chat'
import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils'

const MAX_BODY = 30_000

const bodySchema = z
  .object({
    visitorId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    name: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(32).optional(),
    email: z.string().trim().email().max(200).optional().or(z.literal('')),
    message: z.string().trim().min(1).max(4000),
    clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
    /** Honeypot: real visitors never fill it. */
    website: z.string().max(200).optional(),
  })
  .strict()

export function OPTIONS() {
  return chatPreflight()
}

/** Begin (or resume) a chat: pre-chat details + first message in, token + history out. */
export async function POST(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const ip = getClientIp(request)
  if (!checkRateLimit(`chat-start:${ip}:${publicId}`, RATE_LIMITS.chatStart).success) {
    return chatJson({ ok: false, error: 'rate_limited' }, 429, { 'Retry-After': '60' })
  }

  const text = await request.text().catch(() => '')
  if (text.length > MAX_BODY) return chatJson({ ok: false, error: 'too_large' }, 413)
  let raw: unknown
  try {
    raw = JSON.parse(text || '{}')
  } catch {
    return chatJson({ ok: false, error: 'bad_json' }, 400)
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return chatJson({ ok: false, error: 'invalid' }, 400)
  const body = parsed.data
  if (body.website) return chatJson({ ok: true, ignored: true }) // bot: look successful, store nothing

  const loaded = await loadChatForm(publicId)
  if (!loaded.ok) return loaded.res
  const { db, form } = loaded.value

  // Only collect what this widget asks for; honour its required flags.
  const fields = Array.isArray(form.fields) ? (form.fields as { kind?: string; required?: boolean }[]) : []
  const asks = (kind: string) => fields.some((f) => f.kind === kind)
  const required = (kind: string) => fields.some((f) => f.kind === kind && f.required === true)
  const name = asks('name') ? body.name || null : null
  const email = asks('email') ? body.email || null : null
  let phone: string | null = null
  if (asks('phone') && body.phone) {
    phone = parseInternationalPhone(body.phone)
    if (!phone) return chatJson({ ok: false, error: 'invalid_phone' }, 400)
  }
  if ((required('name') && !name) || (required('email') && !email) || (required('phone') && !phone)) {
    return chatJson({ ok: false, error: 'missing_field' }, 400)
  }

  // A brand-new visitor over the plan's contact limit cannot open a chat.
  try {
    const known = await db.from('contacts').select('id').eq('account_id', form.account_id).eq('web_visitor_id', body.visitorId).maybeSingle()
    if (!known.data) {
      const { limit } = await getLimit(db, form.account_id, 'contacts')
      if (limit !== null) {
        const { count } = await db.from('contacts').select('id', { count: 'exact', head: true }).eq('account_id', form.account_id)
        if ((count ?? 0) >= limit) return chatJson({ ok: false, error: 'unavailable' }, 503)
      }
    }
  } catch {
    // Fail open: a counter hiccup must not turn visitors away.
  }

  try {
    const widget = { formId: form.id, formName: form.name, accountId: form.account_id }
    const thread = await openVisitorThread(db, widget, { visitorId: body.visitorId, name, phone, email })
    const label = name || email || phone || 'Website visitor'
    await recordVisitorMessage(db, {
      accountId: form.account_id,
      contactId: thread.contactId,
      conversationId: thread.conversationId,
      content: { text: body.message, clientId: body.clientId },
      announceNew: { widgetName: form.name, label },
    })

    const token = await signChatToken(
      { cid: thread.conversationId, aid: form.account_id, sub: body.visitorId, role: 'visitor', exp: Math.floor(Date.now() / 1000) + VISITOR_TOKEN_TTL_S },
      await chatSecret(),
    )
    const { data: rows } = await db.from('messages').select(CHAT_MESSAGE_COLUMNS).eq('conversation_id', thread.conversationId).order('created_at', { ascending: false }).limit(50)
    const history = ((rows as ChatMessageRow[] | null) ?? []).reverse()
    const names = await loadSenderNames(db, form.account_id, history)
    return chatJson({
      ok: true,
      token,
      conversationId: thread.conversationId,
      messages: history.map((r) => toChatMessageView(r, r.sender_id ? names.get(r.sender_id) : null)),
    })
  } catch (err) {
    console.error('[chat/start] failed:', err instanceof Error ? err.message : err)
    return chatJson({ ok: false, error: 'server_error' }, 500)
  }
}
