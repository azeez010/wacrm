import { describe, expect, it } from 'vitest'
import { sha256Hex, supportGate, supportInfo } from './session'

const NOW = Date.parse('2026-11-27T12:00:00Z')
const user = (m: Record<string, unknown>) => ({ app_metadata: m })

describe('supportInfo', () => {
  it('is null for a normal user, and reads the session from app_metadata', () => {
    expect(supportInfo(null)).toBeNull()
    expect(supportInfo(user({ provider: 'email' }))).toBeNull()
    expect(supportInfo(user({ support_session: 's1', support_admin: 'a@x', support_read_only: false, support_expires_at: '2026-11-27T12:30:00Z' })))
      .toEqual({ sessionId: 's1', admin: 'a@x', readOnly: false, expiresAt: Date.parse('2026-11-27T12:30:00Z') })
  })
  it('defaults to read-only and already expired when fields are missing', () => {
    expect(supportInfo(user({ support_session: 's1' }))).toMatchObject({ readOnly: true, expiresAt: 0 })
  })
})

describe('supportGate', () => {
  const ro = { sessionId: 's', admin: 'a', readOnly: true, expiresAt: NOW + 60_000 }
  it('lets normal users through untouched', () => {
    expect(supportGate(null, 'POST', '/api/contacts', NOW)).toBe('allow')
  })
  it('blocks changes in a read-only session but allows reading and ending', () => {
    expect(supportGate(ro, 'GET', '/inbox', NOW)).toBe('allow')
    expect(supportGate(ro, 'POST', '/api/contacts', NOW)).toBe('read_only')
    expect(supportGate(ro, 'DELETE', '/api/contacts/1', NOW)).toBe('read_only')
    expect(supportGate(ro, 'POST', '/api/support/end', NOW)).toBe('allow')
  })
  it('allows changes when the admin allowed them', () => {
    expect(supportGate({ ...ro, readOnly: false }, 'POST', '/api/contacts', NOW)).toBe('allow')
  })
  it('ends an expired session on any page', () => {
    expect(supportGate({ ...ro, expiresAt: NOW - 1 }, 'GET', '/inbox', NOW)).toBe('expired')
    expect(supportGate({ ...ro, expiresAt: NOW - 1 }, 'GET', '/support/ended', NOW)).toBe('allow')
  })
})

describe('sha256Hex', () => {
  it('matches the known digest', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
