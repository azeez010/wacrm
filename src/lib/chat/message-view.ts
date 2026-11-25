import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessageView } from './protocol'

/** The message columns the widget needs. */
export const CHAT_MESSAGE_COLUMNS =
  'id, sender_type, sender_id, content_type, content_text, media_url, interactive_payload, ai_generated, created_at'

export interface ChatMessageRow {
  id: string
  sender_type: string
  sender_id?: string | null
  content_type: string
  content_text: string | null
  media_url: string | null
  interactive_payload?: unknown
  ai_generated?: boolean | null
  created_at: string
}

/** Row -> what the visitor's widget renders. Pure. */
export function toChatMessageView(row: ChatMessageRow, senderName?: string | null): ChatMessageView {
  const sender = row.sender_type === 'customer' || row.sender_type === 'bot' ? row.sender_type : 'agent'
  const type = row.content_type === 'image' || row.content_type === 'interactive' || row.content_type === 'event' ? row.content_type : 'text'
  return {
    id: row.id,
    sender_type: sender,
    content_type: type,
    content_text: row.content_text,
    media_url: row.media_url,
    ...(type === 'interactive' ? { interactive_payload: row.interactive_payload } : {}),
    sender_name: sender === 'agent' ? (senderName ?? null) : null,
    ai_generated: row.ai_generated === true,
    created_at: row.created_at,
  }
}

/** Display names for the teammates behind `agent` messages (first names only: the visitor is a stranger). */
export async function loadSenderNames(db: SupabaseClient, accountId: string, rows: ChatMessageRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.filter((r) => r.sender_type === 'agent' && r.sender_id).map((r) => r.sender_id as string))]
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const { data } = await db.from('profiles').select('user_id, full_name').eq('account_id', accountId).in('user_id', ids)
  for (const p of (data as { user_id: string; full_name: string | null }[] | null) ?? []) {
    const first = (p.full_name ?? '').trim().split(/\s+/)[0]
    if (first) out.set(p.user_id, first)
  }
  return out
}
