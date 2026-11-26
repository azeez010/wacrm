import { describe, expect, it, vi } from 'vitest'

vi.mock('./admin-client', () => ({ supabaseAdmin: () => ({}) }))

import { pickContactConversation } from './engine'

describe('pickContactConversation', () => {
  it('prefers the WhatsApp thread, then the newest', () => {
    const wa = { id: 'wa', channel: 'whatsapp', created_at: '2026-01-01T00:00:00Z' }
    const chatOld = { id: 'c1', channel: 'web_chat', created_at: '2026-02-01T00:00:00Z' }
    const chatNew = { id: 'c2', channel: 'web_chat', created_at: '2026-03-01T00:00:00Z' }
    expect(pickContactConversation([chatNew, wa])?.id).toBe('wa')
    expect(pickContactConversation([chatOld, chatNew])?.id).toBe('c2')
    expect(pickContactConversation([{ id: 'legacy', channel: null, created_at: '2025-01-01T00:00:00Z' }, chatNew])?.id).toBe('legacy')
    expect(pickContactConversation([])).toBeNull()
  })
})
