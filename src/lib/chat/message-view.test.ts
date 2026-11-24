import { describe, expect, it } from 'vitest'
import { toChatMessageView } from './message-view'

const base = { id: 'm1', content_type: 'text', content_text: 'hi', media_url: null, created_at: '2026-11-24T10:00:00Z' }

describe('toChatMessageView', () => {
  it('maps sender types and hides the name of anyone but a teammate', () => {
    expect(toChatMessageView({ ...base, sender_type: 'customer' }, 'Ada').sender_name).toBeNull()
    expect(toChatMessageView({ ...base, sender_type: 'agent' }, 'Ada').sender_name).toBe('Ada')
    expect(toChatMessageView({ ...base, sender_type: 'bot', ai_generated: true }).ai_generated).toBe(true)
  })
  it('collapses unknown content types to text and keeps interactive payloads only for interactive', () => {
    expect(toChatMessageView({ ...base, sender_type: 'agent', content_type: 'video' }).content_type).toBe('text')
    const i = toChatMessageView({ ...base, sender_type: 'bot', content_type: 'interactive', interactive_payload: { body: 'x' } })
    expect(i.interactive_payload).toEqual({ body: 'x' })
    expect('interactive_payload' in toChatMessageView({ ...base, sender_type: 'agent' })).toBe(false)
  })
})
