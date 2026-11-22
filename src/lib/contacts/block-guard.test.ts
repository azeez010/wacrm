import { describe, expect, it } from 'vitest'
import { assertNotBlocked, ContactBlockedError, isBlocked } from './block-guard'

describe('block guard', () => {
  it('treats only a set blocked_at as blocked', () => {
    expect(isBlocked(null)).toBe(false)
    expect(isBlocked({})).toBe(false)
    expect(isBlocked({ blocked_at: null })).toBe(false)
    expect(isBlocked({ blocked_at: '2026-01-01T00:00:00Z' })).toBe(true)
  })
  it('throws a coded error', () => {
    expect(() => assertNotBlocked({ blocked_at: 'x' })).toThrow(ContactBlockedError)
    expect(() => assertNotBlocked({ blocked_at: null })).not.toThrow()
    try {
      assertNotBlocked({ blocked_at: 'x' })
    } catch (e) {
      expect((e as ContactBlockedError).code).toBe('contact_blocked')
    }
  })
})
