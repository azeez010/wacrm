import { authorizeVisitor, chatJson, chatPreflight } from '@/lib/chat/http'
import { CHAT_MESSAGE_COLUMNS, loadSenderNames, toChatMessageView, type ChatMessageRow } from '@/lib/chat/message-view'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

export function OPTIONS() {
  return chatPreflight()
}

/** The visitor's thread: history on load, and the polling fallback when the WebSocket is down. ?since=<ISO> returns only newer messages. */
export async function GET(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const auth = await authorizeVisitor(request, publicId)
  if (!auth.ok) return auth.res
  const { db, token, form } = auth.value
  if (!checkRateLimit(`chat-poll:${token.cid}`, RATE_LIMITS.chatPoll).success) {
    return chatJson({ ok: false, error: 'rate_limited' }, 429, { 'Retry-After': '10' })
  }

  const since = new URL(request.url).searchParams.get('since')
  let query = db.from('messages').select(CHAT_MESSAGE_COLUMNS).eq('conversation_id', token.cid)
  if (since && !Number.isNaN(Date.parse(since))) {
    query = query.gt('created_at', new Date(since).toISOString()).order('created_at', { ascending: true }).limit(100)
  } else {
    query = query.order('created_at', { ascending: false }).limit(50)
  }
  const { data, error } = await query
  if (error) return chatJson({ ok: false, error: 'server_error' }, 500)
  const rows = (data as ChatMessageRow[] | null) ?? []
  const ordered = since ? rows : rows.reverse()
  const names = await loadSenderNames(db, form.account_id, ordered)
  return chatJson({ ok: true, messages: ordered.map((r) => toChatMessageView(r, r.sender_id ? names.get(r.sender_id) : null)) })
}
