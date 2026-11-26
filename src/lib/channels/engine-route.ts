import type { SupabaseClient } from '@supabase/supabase-js'

import { sendWebChatMessage } from '@/lib/channels/dispatch'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'

// ============================================================
// Flows, automations and the AI reply were written against WhatsApp: their
// senders look up the contact's phone and call Meta. A website-chat
// conversation has no WhatsApp thread, and messaging the phone a visitor typed
// would be wrong, so each sender asks this first: "is this a web chat?" and, if
// so, hands the message to the web-chat dispatcher instead.
// ============================================================

/** True when the conversation is a website live chat (scoped to the account). */
export async function isWebChatConversation(db: SupabaseClient, accountId: string, conversationId: string): Promise<boolean> {
  const { data } = await db.from('conversations').select('channel').eq('id', conversationId).eq('account_id', accountId).maybeSingle()
  return (data as { channel?: string | null } | null)?.channel === 'web_chat'
}

export type EngineWebChatMessage =
  | { type: 'text'; text: string; aiGenerated?: boolean; aiAgentId?: string | null }
  | { type: 'image'; url: string; caption?: string }
  | { type: 'interactive'; payload: InteractiveMessagePayload }

/**
 * Send an engine message into a web chat. Returns the id the engines record
 * (`whatsapp_message_id` for them), which is also stored on the row.
 */
export async function sendEngineWebChat(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  msg: EngineWebChatMessage,
): Promise<{ whatsapp_message_id: string }> {
  const base = { bot: true as const }
  const r =
    msg.type === 'text'
      ? await sendWebChatMessage(db, accountId, conversationId, { ...base, messageType: 'text', contentText: msg.text, aiGenerated: msg.aiGenerated, aiAgentId: msg.aiAgentId })
      : msg.type === 'image'
        ? await sendWebChatMessage(db, accountId, conversationId, { ...base, messageType: 'image', mediaUrl: msg.url, contentText: msg.caption })
        : await sendWebChatMessage(db, accountId, conversationId, { ...base, messageType: 'interactive', interactivePayload: msg.payload })
  return { whatsapp_message_id: r.externalId }
}
