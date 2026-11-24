import { describe, expect, it } from 'vitest'

import { compactNumber, parseFormStats, summarizeStats, timeAgo } from './stats'

describe('parseFormStats', () => {
  it('returns null when there is no cache yet', () => {
    expect(parseFormStats(null)).toBeNull()
    expect(parseFormStats('x')).toBeNull()
  })
  it('reads the cache and ignores junk values', () => {
    const s = parseFormStats({ views: 120, visitors: 80, starts: 30, leads: 10, attention: 'x', conversion: 12.5, last_lead_at: '2026-11-20T10:00:00Z', spark: [0, 1, 'a'] })
    expect(s).toMatchObject({ views: 120, visitors: 80, leads: 10, attention: 0, conversion: 12.5, window_days: 30 })
    expect(s?.spark).toEqual([0, 1, 0])
  })
})

describe('summarizeStats', () => {
  it('totals the forms that have a cache', () => {
    const a = parseFormStats({ views: 100, visitors: 50, leads: 5 })
    const b = parseFormStats({ views: 20, visitors: 10, leads: 1 })
    expect(summarizeStats([a, b, null])).toEqual({ leads: 6, views: 120, visitors: 60, conversion: 10 })
    expect(summarizeStats([null])).toBeNull()
  })
  it('has no conversion without visitors', () => {
    expect(summarizeStats([parseFormStats({ leads: 3 })])?.conversion).toBeNull()
  })
})

describe('formatting', () => {
  it('compacts numbers', () => {
    expect(compactNumber(1200, 'en')).toBe('1.2K')
    expect(compactNumber(42, 'en')).toBe('42')
  })
  it('says how long ago', () => {
    const now = Date.parse('2026-11-24T12:00:00Z')
    expect(timeAgo('2026-11-24T10:00:00Z', 'en', now)).toBe('2 hours ago')
    expect(timeAgo('2026-11-21T12:00:00Z', 'en', now)).toBe('3 days ago')
  })
})
