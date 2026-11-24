import { describe, expect, it } from 'vitest'
import { createFrameLimiter, parseClientFrame, roomHasCapacity, typingTarget } from './protocol'

describe('parseClientFrame', () => {
  it('accepts ping and typing', () => {
    expect(parseClientFrame('{"type":"ping"}')).toEqual({ type: 'ping' })
    expect(parseClientFrame('{"type":"typing","on":true}')).toEqual({ type: 'typing', on: true })
  })
  it('rejects junk, wrong types, oversize frames and non-strings', () => {
    for (const bad of ['', 'nope', '[]', 'null', '{"type":"typing"}', '{"type":"typing","on":"yes"}', '{"type":"message","text":"hi"}', 'x'.repeat(600), 42, null, new ArrayBuffer(4)]) {
      expect(parseClientFrame(bad as unknown)).toBeNull()
    }
  })
})

describe('createFrameLimiter', () => {
  it('allows up to the limit per window, then resets', () => {
    const allow = createFrameLimiter(3, 1000)
    expect([0, 1, 2, 3].map((i) => allow(100 + i))).toEqual([true, true, true, false])
    expect(allow(1200)).toBe(true)
  })
})

describe('room helpers', () => {
  it('caps sockets per role', () => {
    expect(roomHasCapacity('visitor', { visitor: 4, agent: 0 })).toBe(true)
    expect(roomHasCapacity('visitor', { visitor: 5, agent: 0 })).toBe(false)
    expect(roomHasCapacity('agent', { visitor: 0, agent: 24 })).toBe(true)
    expect(roomHasCapacity('agent', { visitor: 0, agent: 25 })).toBe(false)
  })
  it('forwards typing to the other side', () => {
    expect(typingTarget('visitor')).toBe('agent')
    expect(typingTarget('agent')).toBe('visitor')
  })
})
