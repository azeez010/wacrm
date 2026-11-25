import type { SupabaseClient } from '@supabase/supabase-js'

import { channelCapabilities, type ChannelId } from '@/lib/channels/registry'
import { CHAT_MESSAGE_COLUMNS, loadSenderNames, toChatMessageView, type ChatMessageRow } from '@/lib/chat/message-view'
import { pushToRoom } from '@/lib/chat/room'
import { interactivePayloadPreviewText } from '@/lib/whatsapp/interactive'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'

// ============================================================
// Outbound for channels other than WhatsApp. WhatsApp keeps its own path in
// src/lib/whatsapp/send-message.ts (it talks to Meta); a channel here is
// "persist the message, then push it to wherever the contact is listening".
// ============================================================

export class ChannelSendError extends Error {
  constructor(
    readonly code: 'bad_request' | 'channel_not_supported' | 'db_error',
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ChannelSendError'
  }
}

export interface ChannelSendParams {
  messageType: string
  contentText?: string | null
  mediaUrl?: string | null
  interactivePayload?: InteractiveMessagePayload | null
  senderId?: string | null
  /** Set for automated senders (flows, AI); a human leaves it false. */
  bot?: boolean
  aiGenerated?: boolean
}

/** Send into a website live-chat conversation: store it, bump the thread, push it to the visitor. */
export async function sendWebChatMessage(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  params: ChannelSendParams,
): Promise<{ messageId: string }> {
  const caps = channelCapabilities('web_chat' satisfies ChannelId)
  const type = params.messageType
  if (type === 'template') {
    throw new ChannelSendError('channel_not_supported', 'Templates are WhatsApp only.', 400)
  }
  if (type === 'interactive') {
    if (!caps.interactive || !params.interactivePayload) throw new ChannelSendError('bad_request', 'Interactive messages need a payload.', 400)
  } else if (type === 'image') {
    if (!params.mediaUrl) throw new ChannelSendError('bad_request', 'An image needs a media URL.', 400)
  } else if (type === 'text') {
    if (!params.contentText?.trim()) throw new ChannelSendError('bad_request', 'A text message needs content.', 400)
  } else {
    throw new ChannelSendError('channel_not_supported', 'Website chat carries text and images.', 400)
  }

  // The first time a teammate replies in this chat, say so in the timeline ("Jide just joined the chat").
  if (!params.bot && params.senderId) await announceAgentJoined(db, accountId, conversationId, params.senderId)

  const text = type === 'interactive' ? params.interactivePayload!.body : (params.contentText ?? null)
  const { data, error } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: params.bot ? 'bot' : 'agent',
      sender_id: params.senderId ?? null,
      content_type: type,
      content_text: text,
      media_url: type === 'image' ? params.mediaUrl : null,
      interactive_payload: type === 'interactive' ? params.interactivePayload : null,
      ai_generated: params.aiGenerated === true,
      status: 'sent',
    })
    .select(CHAT_MESSAGE_COLUMNS)
    .single()
  if (error || !data) throw new ChannelSendError('db_error', `Failed to save the message: ${error?.message ?? 'unknown'}`, 500)
  const row = data as ChatMessageRow

  const preview = type === 'interactive' ? interactivePayloadPreviewText(params.interactivePayload!) : text || `[${type}]`
  await db
    .from('conversations')
    .update({ last_message_text: preview, last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('account_id', accountId)

  const names = await loadSenderNames(db, accountId, [row])
  await pushToRoom(conversationId, { type: 'message', message: toChatMessageView(row, row.sender_id ? names.get(row.sender_id) : null) }, 'visitor')
  return { messageId: row.id }
}

/** One centred "<name> just joined the chat" line per teammate per conversation. Best-effort: never blocks the reply. */
async function announceAgentJoined(db: SupabaseClient, accountId: string, conversationId: string, agentId: string): Promise<void> {
  try {
    const { data: prior } = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('content_type', 'event')
      .eq('sender_id', agentId)
      .limit(1)
    if ((prior?.length ?? 0) > 0) return
    const { data: profile } = await db.from('profiles').select('full_name').eq('account_id', accountId).eq('user_id', agentId).maybeSingle()
    const name = ((profile as { full_name?: string | null } | null)?.full_name ?? '').trim().split(/\s+/)[0]
    if (!name) return
    const { data } = await db
      .from('messages')
      .insert({ conversation_id: conversationId, sender_type: 'bot', sender_id: agentId, content_type: 'event', content_text: name, status: 'sent' })
      .select(CHAT_MESSAGE_COLUMNS)
      .single()
    if (data) await pushToRoom(conversationId, { type: 'message', message: toChatMessageView(data as ChatMessageRow) }, 'visitor')
  } catch (err) {
    console.error('[web-chat] join event failed:', err instanceof Error ? err.message : err)
  }
}
