import { describe, expect, it } from 'vitest'
import { computeOnline, isWithinHours, reachableTeammates } from './online'

// 2026-11-23 is a Monday.
const at = (iso: string) => new Date(iso)

describe('isWithinHours', () => {
  it('is always open when no hours are configured or enabled', () => {
    expect(isWithinHours(undefined, 'UTC', at('2026-11-22T03:00:00Z'))).toBe(true)
    expect(isWithinHours({ enabled: false }, 'UTC', at('2026-11-22T03:00:00Z'))).toBe(true)
  })
  it('checks day and time in the account timezone', () => {
    const h = { enabled: true, days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' }
    expect(isWithinHours(h, 'Africa/Lagos', at('2026-11-23T10:00:00Z'))).toBe(true) // 11:00 Lagos Mon
    expect(isWithinHours(h, 'Africa/Lagos', at('2026-11-23T16:30:00Z'))).toBe(false) // 17:30 Lagos
    expect(isWithinHours(h, 'Africa/Lagos', at('2026-11-22T10:00:00Z'))).toBe(false) // Sunday
    expect(isWithinHours(h, 'America/New_York', at('2026-11-23T13:00:00Z'))).toBe(false) // 08:00 NY, before opening
    expect(isWithinHours(h, 'America/New_York', at('2026-11-23T15:00:00Z'))).toBe(true) // 10:00 NY
  })
  it('handles an overnight window and a bad timezone', () => {
    const night = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], from: '22:00', to: '06:00' }
    expect(isWithinHours(night, 'UTC', at('2026-11-23T23:00:00Z'))).toBe(true)
    expect(isWithinHours(night, 'UTC', at('2026-11-23T05:00:00Z'))).toBe(true)
    expect(isWithinHours(night, 'UTC', at('2026-11-23T12:00:00Z'))).toBe(false)
    expect(isWithinHours({ enabled: true, from: '09:00', to: '17:00' }, 'Not/AZone', at('2026-11-22T03:00:00Z'))).toBe(true)
  })
})

describe('computeOnline', () => {
  it('needs the hours open and an AI agent or a human', () => {
    expect(computeOnline(true, { aiActive: true, humansOnline: 0 })).toBe(true)
    expect(computeOnline(true, { aiActive: false, humansOnline: 2 })).toBe(true)
    expect(computeOnline(true, { aiActive: false, humansOnline: 0 })).toBe(false)
    expect(computeOnline(false, { aiActive: true, humansOnline: 3 })).toBe(false)
  })
})

describe('reachableTeammates', () => {
  const now = Date.parse('2026-11-25T10:00:00Z')
  const row = (user_id: string, status: string, secsAgo: number) => ({ user_id, status, last_seen_at: new Date(now - secsAgo * 1000).toISOString() })
  it('counts online and away with a fresh heartbeat, newest first, and drops offline or stale ones', () => {
    const out = reachableTeammates([row('a', 'away', 40), row('b', 'online', 10), row('c', 'offline', 5), row('d', 'online', 300)], now)
    expect(out.map((r) => r.user_id)).toEqual(['b', 'a'])
  })
})
