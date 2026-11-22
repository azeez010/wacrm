import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  seeded: [] as string[],
  inserts: [] as Record<string, unknown>[],
  accountUpdates: [] as Record<string, unknown>[],
  insertError: null as { code?: string; message: string } | null,
  insertSteps: vi.fn(async () => null),
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { seeded_defaults: h.seeded } }),
        insert: (row: Record<string, unknown>) => {
          h.inserts.push({ table, ...row })
          return chain
        },
        single: async () =>
          h.insertError ? { data: null, error: h.insertError } : { data: { id: 'auto-1' }, error: null },
        update: (row: Record<string, unknown>) => {
          h.accountUpdates.push(row)
          return chain
        },
        delete: () => chain,
        then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r),
      }
      return chain
    },
  }),
}))
vi.mock('./steps-tree', async (orig) => ({ ...(await orig<object>()), insertSteps: h.insertSteps }))

import { ensureDefaultAutomations } from './seed-defaults'

beforeEach(() => {
  h.seeded = []
  h.inserts = []
  h.accountUpdates = []
  h.insertError = null
  h.insertSteps.mockClear()
})

describe('ensureDefaultAutomations', () => {
  it('creates the active, system-keyed Unsubscribe automation once and records it', async () => {
    const r = await ensureDefaultAutomations('acc-1', 'user-1')
    expect(r.created).toEqual(['unsubscribe'])
    expect(h.inserts[0]).toMatchObject({ table: 'automations', account_id: 'acc-1', is_active: true, system_key: 'unsubscribe' })
    expect(h.insertSteps).toHaveBeenCalledTimes(1)
    expect(h.accountUpdates[0]).toEqual({ seeded_defaults: ['unsubscribe'] })
  })
  it('never recreates it once seeded, even if the user deleted it', async () => {
    h.seeded = ['unsubscribe']
    const r = await ensureDefaultAutomations('acc-1', 'user-1')
    expect(r.created).toEqual([])
    expect(h.inserts).toHaveLength(0)
  })
  it('loses a race quietly (unique violation) without inserting steps twice', async () => {
    h.insertError = { code: '23505', message: 'dup' }
    const r = await ensureDefaultAutomations('acc-1', 'user-1')
    expect(r.created).toEqual([])
    expect(h.insertSteps).not.toHaveBeenCalled()
  })
})
