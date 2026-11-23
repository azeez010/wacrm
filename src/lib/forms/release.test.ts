import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  held: [] as { id: string }[],
  accepted: 0,
  limit: null as number | null,
  updates: [] as { patch: unknown; ids: unknown }[],
  reprocessed: [] as string[],
}))

vi.mock('@/lib/billing/entitlements', () => ({ getLimit: vi.fn(async () => ({ planName: 'Free', limit: h.limit })) }))
vi.mock('@/lib/billing/usage', () => ({ monthStartUtc: () => new Date('2026-01-01T00:00:00Z') }))
vi.mock('./submit', () => ({
  reprocessSubmission: vi.fn(async (_db: unknown, _form: unknown, sub: { id: string }) => {
    h.reprocessed.push(sub.id)
  }),
}))

import { releaseHeldLeads, RELEASE_BATCH } from './release'

const db = {
  from: () => {
    let op = 'select'
    let patch: unknown
    const b: Record<string, unknown> = {
      select: () => b,
      update: (p: unknown) => ((op = 'update'), (patch = p), b),
      eq: () => b,
      order: () => b,
      limit: () => Promise.resolve({ data: h.held, error: null }),
      in: (_k: string, ids: unknown) => {
        h.updates.push({ patch, ids })
        return b
      },
      then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null, data: op === 'update' ? null : [] }).then(res),
    }
    return b
  },
  rpc: async () => ({ data: { accepted: h.accepted, held: h.held.length }, error: null }),
}
const form = { id: 'f1', account_id: 'a1' } as never

beforeEach(() => {
  h.held = []
  h.accepted = 0
  h.limit = null
  h.updates = []
  h.reprocessed = []
})

describe('releaseHeldLeads', () => {
  it('does nothing when nothing is held', async () => {
    const r = await releaseHeldLeads(db as never, form)
    expect(r).toMatchObject({ released: 0, stillHeld: 0, reason: null })
  })

  it('releases everything when the plan is unlimited, then runs the follow-up for each, oldest first', async () => {
    h.held = [{ id: 's1' }, { id: 's2' }, { id: 's3' }]
    const r = await releaseHeldLeads(db as never, form)
    expect(r).toMatchObject({ released: 3, stillHeld: 0, reason: null })
    expect(h.updates[0]).toMatchObject({ patch: { outcome: 'accepted' }, ids: ['s1', 's2', 's3'] })
    await r.run()
    expect(h.reprocessed).toEqual(['s1', 's2', 's3'])
  })

  it('only releases what the plan has room for, keeping the rest held', async () => {
    h.held = [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }]
    h.limit = 100
    h.accepted = 98
    const r = await releaseHeldLeads(db as never, form)
    expect(r).toMatchObject({ released: 2, stillHeld: 2, reason: 'plan_limit' })
    expect(h.updates[0].ids).toEqual(['s1', 's2'])
  })

  it('no room at all: nothing changes and it says why', async () => {
    h.held = [{ id: 's1' }]
    h.limit = 100
    h.accepted = 100
    const r = await releaseHeldLeads(db as never, form)
    expect(r).toMatchObject({ released: 0, stillHeld: 1, reason: 'plan_limit' })
    expect(h.updates).toHaveLength(0)
  })

  it('caps one call at the batch size', async () => {
    h.held = Array.from({ length: RELEASE_BATCH + 1 }, (_, i) => ({ id: `s${i}` }))
    const r = await releaseHeldLeads(db as never, form)
    expect(r.released).toBe(RELEASE_BATCH)
    expect(r).toMatchObject({ stillHeld: 1, reason: 'batch' })
  })
})
