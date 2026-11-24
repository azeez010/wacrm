import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  pushed: [] as unknown[][],
  insertError: null as { message: string } | null,
}))

vi.mock('@/lib/chat/room', () => ({ pushToRoom: async (...a: unknown[]) => { h.pushed.push(a); return 1 } }))

const row = (p: Record<string, unknown>) => ({
  id: 'm1', sender_type: 'agent', sender_id: 'u1', content_type: 'text', content_text: 'hi', media_url: null,
  interactive_payload: null, ai_generated: false, created_at: '2026-11-24T10:00:00Z', ...p,
})

function fakeDb() {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      let op = 'select'
      chain.insert = (p: Record<string, unknown>) => { op = 'insert'; h.inserted.push(p); return chain }
      chain.update = (p: Record<string, unknown>) => { op = 'update'; h.updated.push(p); return chain }
      for (const m of ['select', 'eq', 'in']) chain[m] = () => chain
      chain.single = async () => (h.insertError ? { data: null, error: h.insertError } : { data: row(h.inserted.at(-1) ?? {}), error: null })
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve(table === 'profiles' ? { data: [{ user_id: 'u1', full_name: 'Ada Obi' }] } : { error: null, data: op }).then(res)
      return chain
    },
  }
}

import { ChannelSendError, sendWebChatMessage } from './dispatch'

const send = (p: Parameters<typeof sendWebChatMessage>[3]) => sendWebChatMessage(fakeDb() as never, 'acc-1', 'conv-1', p)

beforeEach(() => { h.inserted = []; h.updated = []; h.pushed = []; h.insertError = null })

describe('sendWebChatMessage', () => {
  it('stores an agent text reply, updates the thread preview and pushes it to the visitor only, with the first name', async () => {
    const r = await send({ messageType: 'text', contentText: 'Hello there', senderId: 'u1' })
    expect(r.messageId).toBe('m1')
    expect(h.inserted[0]).toMatchObject({ conversation_id: 'conv-1', sender_type: 'agent', sender_id: 'u1', content_type: 'text', content_text: 'Hello there', status: 'sent' })
    expect(h.updated[0]).toMatchObject({ last_message_text: 'Hello there' })
    const [cid, frame, to] = h.pushed[0] as [string, { type: string; message: { sender_name: string } }, string]
    expect(cid).toBe('conv-1')
    expect(to).toBe('visitor')
    expect(frame.type).toBe('message')
    expect(frame.message.sender_name).toBe('Ada')
  })

  it('marks automated sends as bot / AI-generated', async () => {
    await send({ messageType: 'text', contentText: 'Hi', bot: true, aiGenerated: true })
    expect(h.inserted[0]).toMatchObject({ sender_type: 'bot', ai_generated: true })
  })

  it('carries an image', async () => {
    await send({ messageType: 'image', mediaUrl: 'https://x/y.png', senderId: 'u1' })
    expect(h.inserted[0]).toMatchObject({ content_type: 'image', media_url: 'https://x/y.png' })
  })

  it('refuses templates, other media kinds and incomplete messages', async () => {
    await expect(send({ messageType: 'template', contentText: 'x' })).rejects.toMatchObject({ code: 'channel_not_supported' })
    await expect(send({ messageType: 'video', mediaUrl: 'https://x/v.mp4' })).rejects.toMatchObject({ code: 'channel_not_supported' })
    await expect(send({ messageType: 'text', contentText: '  ' })).rejects.toMatchObject({ code: 'bad_request' })
    await expect(send({ messageType: 'image' })).rejects.toMatchObject({ code: 'bad_request' })
    await expect(send({ messageType: 'interactive' })).rejects.toBeInstanceOf(ChannelSendError)
    expect(h.inserted).toHaveLength(0)
  })

  it('surfaces a storage failure and pushes nothing', async () => {
    h.insertError = { message: 'boom' }
    await expect(send({ messageType: 'text', contentText: 'hi' })).rejects.toMatchObject({ code: 'db_error', status: 500 })
    expect(h.pushed).toHaveLength(0)
  })
})
