import { describe, expect, it } from 'vitest'
import { recordDeliveryStatus, shouldMarkActive, shouldMarkUnreachable } from './number-status'

const NOW = new Date('2026-11-26T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

describe('reachability rules', () => {
  it('a 131026 marks unknown or unreachable numbers, and active ones only after 30 quiet days', () => {
    expect(shouldMarkUnreachable({ wa_status: null, wa_status_at: null }, NOW)).toBe(true)
    expect(shouldMarkUnreachable({ wa_status: 'unreachable', wa_status_at: daysAgo(1) }, NOW)).toBe(true)
    expect(shouldMarkUnreachable({ wa_status: 'active', wa_status_at: daysAgo(5) }, NOW)).toBe(false)
    expect(shouldMarkUnreachable({ wa_status: 'active', wa_status_at: daysAgo(31) }, NOW)).toBe(true)
  })
  it('a sign of life always flips unreachable back, and skips refreshing a fresh active', () => {
    expect(shouldMarkActive({ wa_status: 'unreachable', wa_status_at: daysAgo(0) }, NOW)).toBe(true)
    expect(shouldMarkActive({ wa_status: null, wa_status_at: null }, NOW)).toBe(true)
    expect(shouldMarkActive({ wa_status: 'active', wa_status_at: daysAgo(0.5) }, NOW)).toBe(false)
    expect(shouldMarkActive({ wa_status: 'active', wa_status_at: daysAgo(2) }, NOW)).toBe(true)
  })
})

function fakeDb(rows: { id: string; wa_status: string | null; wa_status_at: string | null }[]) {
  const writes: { patch: Record<string, unknown>; ids: string[] }[] = []
  const db = {
    from: () => {
      let patch: Record<string, unknown> | null = null
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        update: (p: Record<string, unknown>) => ((patch = p), b),
        in: (_k: string, v: string[]) => {
          if (patch) {
            writes.push({ patch, ids: v })
            return Promise.resolve({ error: null })
          }
          return Promise.resolve({ data: rows, error: null })
        },
      }
      return b
    },
  }
  return { db: db as never, writes }
}

describe('recordDeliveryStatus', () => {
  it('delivered marks the matching contact active; sent and other failures are ignored', async () => {
    const f = fakeDb([{ id: 'c1', wa_status: null, wa_status_at: null }])
    await recordDeliveryStatus(f.db, 'acc', '2348031234567', 'delivered', null, NOW)
    expect(f.writes).toEqual([{ patch: { wa_status: 'active', wa_status_at: NOW.toISOString(), wa_status_source: 'delivered' }, ids: ['c1'] }])
    const g = fakeDb([{ id: 'c1', wa_status: null, wa_status_at: null }])
    await recordDeliveryStatus(g.db, 'acc', '2348031234567', 'sent', null, NOW)
    await recordDeliveryStatus(g.db, 'acc', '2348031234567', 'failed', 131047, NOW)
    expect(g.writes).toEqual([])
  })
  it('131026 marks unreachable, but not a contact that was active last week', async () => {
    const f = fakeDb([
      { id: 'ghost', wa_status: null, wa_status_at: null },
      { id: 'recent', wa_status: 'active', wa_status_at: daysAgo(7) },
    ])
    await recordDeliveryStatus(f.db, 'acc', '+2348031234567', 'failed', 131026, NOW)
    expect(f.writes).toHaveLength(1)
    expect(f.writes[0]).toMatchObject({ patch: { wa_status: 'unreachable', wa_status_source: 'failed_131026' }, ids: ['ghost'] })
  })
  it('never throws, even when the database does', async () => {
    const db = { from: () => { throw new Error('down') } } as never
    await expect(recordDeliveryStatus(db, 'acc', '234803', 'failed', 131026, NOW)).resolves.toBeUndefined()
  })
})
