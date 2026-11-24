// ============================================================
// Channels: where a conversation lives. One entry per channel drives the inbox
// (badge, filter, composer controls) and the send engines (what a channel can
// carry). Adding a channel = a new id here, a CHECK widening migration, and a
// sender in src/lib/channels/dispatch.ts.
// ============================================================

export const CHANNEL_IDS = ['whatsapp', 'web_chat'] as const
export type ChannelId = (typeof CHANNEL_IDS)[number]
export const DEFAULT_CHANNEL: ChannelId = 'whatsapp'

export type ChannelMediaKind = 'image' | 'video' | 'audio' | 'document'

export interface ChannelCapabilities {
  /** Pre-approved message templates (WhatsApp only). */
  templates: boolean
  /** Interactive buttons / lists. */
  interactive: boolean
  /** Recorded voice notes. */
  voiceNotes: boolean
  /** Emoji reactions on a message. */
  reactions: boolean
  /** Hours after the customer's last message during which free-form replies are allowed; null = no limit. */
  replyWindowHours: number | null
  /** Media kinds a message can carry. */
  mediaKinds: readonly ChannelMediaKind[]
}

export interface ChannelDef {
  id: ChannelId
  /** i18n key under the `Channels` namespace. */
  labelKey: string
  capabilities: ChannelCapabilities
}

export const CHANNELS: Record<ChannelId, ChannelDef> = {
  whatsapp: {
    id: 'whatsapp',
    labelKey: 'whatsapp',
    capabilities: {
      templates: true,
      interactive: true,
      voiceNotes: true,
      reactions: true,
      replyWindowHours: 24,
      mediaKinds: ['image', 'video', 'audio', 'document'],
    },
  },
  web_chat: {
    id: 'web_chat',
    labelKey: 'web_chat',
    capabilities: {
      templates: false,
      interactive: true,
      voiceNotes: false,
      reactions: false,
      replyWindowHours: null,
      mediaKinds: ['image'],
    },
  },
}

export function isChannelId(value: unknown): value is ChannelId {
  return typeof value === 'string' && (CHANNEL_IDS as readonly string[]).includes(value)
}

/** The channel of a conversation row; rows that predate channels are WhatsApp. */
export function channelOf(conversation: { channel?: string | null } | null | undefined): ChannelId {
  const c = conversation?.channel
  return isChannelId(c) ? c : DEFAULT_CHANNEL
}

export function channelCapabilities(
  conversationOrId: { channel?: string | null } | ChannelId | null | undefined,
): ChannelCapabilities {
  const id = typeof conversationOrId === 'string' ? conversationOrId : channelOf(conversationOrId)
  return CHANNELS[isChannelId(id) ? id : DEFAULT_CHANNEL].capabilities
}
