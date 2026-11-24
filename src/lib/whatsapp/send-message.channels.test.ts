import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ webChat: vi.fn(async () => ({ messageId: 'wc-1' })), meta: vi.fn() }))

vi.mock('@/lib/channels/dispatch', async (orig) => ({ ...(await orig<object>()), sendWebChatMessage: h.webChat }))
vi.mock('@/lib/whatsapp/meta-api', async (orig) => ({
  ...(await orig<object>()),
  sendTextMessage: h.meta,
  sendMediaMessage: h.meta,
  sendTemplateMessage: h.meta,
  sendInteractiveButtons: h.meta,
  sendInteractiveList: h.meta,
}))

import { SendMessageError, sendMessageToConversation } from './send-message'

function dbWith(conversation: Record<string, unknown>) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq']) chain[m] = () => chain
  chain.single = async () => ({ data: conversation, error: null })
  return { from: () => chain } as never
}

const contact = { id: 'c1', phone: '+2348012345678', name: 'Ada', blocked_at: null }

describe('sendMessageToConversation on other channels', () => {
  it('routes a web_chat conversation to the website sender and never touches Meta', async () => {
    const r = await sendMessageToConversation(dbWith({ id: 'conv-1', channel: 'web_chat', contact }), 'acc-1', {
      conversationId: 'conv-1', messageType: 'text', contentText: 'hi', senderId: 'u1',
    })
    expect(r).toEqual({ messageId: 'wc-1', whatsappMessageId: '' })
    expect(h.webChat).toHaveBeenCalledWith(expect.anything(), 'acc-1', 'conv-1', expect.objectContaining({ messageType: 'text', contentText: 'hi', senderId: 'u1' }))
    expect(h.meta).not.toHaveBeenCalled()
  })

  it('still refuses a blocked contact on every channel', async () => {
    await expect(
      sendMessageToConversation(dbWith({ id: 'conv-1', channel: 'web_chat', contact: { ...contact, blocked_at: '2026-01-01T00:00:00Z' } }), 'acc-1', {
        conversationId: 'conv-1', messageType: 'text', contentText: 'hi',
      }),
    ).rejects.toMatchObject({ code: 'contact_blocked' })
    expect(h.webChat).not.toHaveBeenCalled()
  })

  it('maps a channel error (e.g. a template on web chat) to a SendMessageError', async () => {
    const { ChannelSendError } = await import('@/lib/channels/dispatch')
    h.webChat.mockRejectedValueOnce(new ChannelSendError('channel_not_supported', 'Templates are WhatsApp only.', 400))
    await expect(
      sendMessageToConversation(dbWith({ id: 'conv-1', channel: 'web_chat', contact }), 'acc-1', {
        conversationId: 'conv-1', messageType: 'template', templateName: 't',
      }),
    ).rejects.toBeInstanceOf(SendMessageError)
  })
})
