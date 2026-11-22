import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { setContactBlocked } from './block-write'

/** A tiny fake of the two queries setContactBlocked makes. */
function fakeDb(opts: { updated: boolean; exists: boolean }) {
  const calls: { patch?: Record<string, unknown>; filters: [string, unknown][]; neg: string[] } = {
    filters: [],
    neg: [],
  }
  const db = {
    from() {
      const chain: Record<string, unknown> = {
        update(patch: Record<string, unknown>) {
          calls.patch = patch
          return chain
        },
        select() {
          return chain
        },
        eq(col: string, v: unknown) {
          calls.filters.push([col, v])
          return chain
        },
        is(col: string) {
          calls.neg.push(`is:${col}`)
          return chain
        },
        not(col: string) {
          calls.neg.push(`not:${col}`)
          return chain
        },
        maybeSingle: () => Promise.resolve({ data: opts.exists ? { id: 'c1' } : null }),
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: opts.updated ? [{ id: 'c1' }] : [], error: null }).then(res),
      }
      return chain
    },
  } as unknown as SupabaseClient
  return { db, calls }
}

describe('setContactBlocked', () => {
  it('blocks with a reason, scoped to the account, only if not already blocked', async () => {
    const { db, calls } = fakeDb({ updated: true, exists: true })
    const r = await setContactBlocked(db, { accountId: 'a1', contactId: 'c1', blocked: true, reason: 'opt_out', userId: 'u1' })
    expect(r).toEqual({ changed: true, found: true })
    expect(calls.patch).toMatchObject({ blocked_reason: 'opt_out', blocked_by: 'u1' })
    expect(calls.patch?.blocked_at).toBeTruthy()
    expect(calls.filters).toContainEqual(['account_id', 'a1'])
    expect(calls.neg).toContain('is:blocked_at')
  })
  it('unblock clears all three columns', async () => {
    const { db, calls } = fakeDb({ updated: true, exists: true })
    await setContactBlocked(db, { accountId: 'a1', contactId: 'c1', blocked: false })
    expect(calls.patch).toEqual({ blocked_at: null, blocked_reason: null, blocked_by: null })
    expect(calls.neg).toContain('not:blocked_at')
  })
  it('reports changed:false when already in that state, found:false when missing', async () => {
    expect(await setContactBlocked(fakeDb({ updated: false, exists: true }).db, { accountId: 'a', contactId: 'c', blocked: true })).toEqual({ changed: false, found: true })
    expect(await setContactBlocked(fakeDb({ updated: false, exists: false }).db, { accountId: 'a', contactId: 'c', blocked: true })).toEqual({ changed: false, found: false })
  })
})
