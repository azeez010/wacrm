import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  seeded: [] as string[],
  inserts: [] as Record<string, unknown>[],
  accountUpdates: [] as Record<string, unknown>[],
  insertError: null as { code?: string; message: string } | null,
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { seeded_defaults: h.seeded } }),
        insert: async (row: Record<string, unknown>) => {
          h.inserts.push({ table, ...row })
          return { error: h.insertError }
        },
        update: (row: Record<string, unknown>) => {
          h.accountUpdates.push(row)
          return chain
        },
        then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r),
      }
      return chain
    },
  }),
}))

import { ensureDefaultSegments } from './seed-defaults'

beforeEach(() => {
  h.seeded = []
  h.inserts = []
  h.accountUpdates = []
  h.insertError = null
})

describe('ensureDefaultSegments', () => {
  it('creates Blocked and Not blocked once, editable, and records both keys', async () => {
    const r = await ensureDefaultSegments('acc-1', 'user-1')
    expect(r.created).toEqual(['segment_blocked', 'segment_not_blocked'])
    expect(h.inserts).toHaveLength(2)
    expect(h.inserts[0]).toMatchObject({
      table: 'segments',
      account_id: 'acc-1',
      name: 'Blocked',
      locked: false,
      filter: { version: 1, op: 'and', rules: [{ field: 'blocked', operator: 'is_true' }] },
    })
    expect(h.inserts[1]).toMatchObject({
      name: 'Not blocked',
      filter: { rules: [{ field: 'blocked', operator: 'is_false' }] },
    })
    expect(h.accountUpdates[0]).toEqual({ seeded_defaults: ['segment_blocked', 'segment_not_blocked'] })
  })

  it('keeps the existing seeded keys (e.g. the Unsubscribe automation)', async () => {
    h.seeded = ['unsubscribe']
    await ensureDefaultSegments('acc-1', 'user-1')
    expect(h.accountUpdates[0]).toEqual({
      seeded_defaults: ['unsubscribe', 'segment_blocked', 'segment_not_blocked'],
    })
  })

  it('never recreates a segment once seeded, even if the user deleted it', async () => {
    h.seeded = ['segment_blocked', 'segment_not_blocked']
    const r = await ensureDefaultSegments('acc-1', 'user-1')
    expect(r.created).toEqual([])
    expect(h.inserts).toHaveLength(0)
    expect(h.accountUpdates).toHaveLength(0)
  })

  it('treats a name clash (unique violation) as done without creating', async () => {
    h.insertError = { code: '23505', message: 'dup' }
    const r = await ensureDefaultSegments('acc-1', 'user-1')
    expect(r.created).toEqual([])
    expect(h.accountUpdates[0]).toEqual({ seeded_defaults: ['segment_blocked', 'segment_not_blocked'] })
  })

  it('throws on any other insert error and records nothing', async () => {
    h.insertError = { code: '42501', message: 'denied' }
    await expect(ensureDefaultSegments('acc-1', 'user-1')).rejects.toThrow('denied')
    expect(h.accountUpdates).toHaveLength(0)
  })
})
