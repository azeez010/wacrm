import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { grantTrial, trialOfferFor } from './trial'

type Plan = { id: string; name: string; trial_days: number; trial_on_signup: boolean; is_active?: boolean }
const PLANS: Plan[] = [
  { id: 'free', name: 'Free', trial_days: 0, trial_on_signup: false },
  { id: 'starter', name: 'Starter', trial_days: 7, trial_on_signup: false },
  { id: 'pro', name: 'Pro', trial_days: 14, trial_on_signup: true },
]

// Just enough of the query builder for the two helpers.
function fakeDb(opts: { used?: boolean; plans?: Plan[]; rpc?: unknown } = {}) {
  const plans = opts.plans ?? PLANS
  const rpc = vi.fn(async () => ({ data: opts.rpc ?? null, error: null }))
  const from = (table: string) => {
    const f: Record<string, unknown> = {}
    let rows: Record<string, unknown>[] = table === 'plans' ? plans.map((p) => ({ is_active: true, ...p })) : opts.used ? [{ id: 'g1' }] : []
    const api = {
      select: () => api,
      // (trial_grants rows are only ever this person's: the real filter is by user_id.)
      eq: (k: string, v: unknown) => { if (table === 'plans') rows = rows.filter((r) => r[k] === v); return api },
      neq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] !== v); return api },
      gt: (k: string, v: number) => { rows = rows.filter((r) => Number(r[k]) > v); return api },
      limit: () => api,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    }
    return Object.assign(f, api)
  }
  return { db: { from, rpc } as unknown as SupabaseClient, rpc }
}

describe('trialOfferFor', () => {
  it('offers the plan they clicked when it has a trial', async () => {
    expect(await trialOfferFor(fakeDb().db, 'u1', 'starter')).toEqual({ planId: 'starter', planName: 'Starter', days: 7 })
  })
  it('falls back to the default signup trial when they clicked nothing, or something without a trial', async () => {
    expect(await trialOfferFor(fakeDb().db, 'u1', null)).toEqual({ planId: 'pro', planName: 'Pro', days: 14 })
    expect(await trialOfferFor(fakeDb().db, 'u1', 'free')).toEqual({ planId: 'pro', planName: 'Pro', days: 14 })
    expect(await trialOfferFor(fakeDb().db, 'u1', 'nope')).toEqual({ planId: 'pro', planName: 'Pro', days: 14 })
  })
  it('ignores a malformed hint instead of querying with it', async () => {
    expect(await trialOfferFor(fakeDb().db, 'u1', "x'; drop table plans;--")).toEqual({ planId: 'pro', planName: 'Pro', days: 14 })
  })
  it('offers nothing when no plan has a trial, an inactive plan, or the person already had one', async () => {
    expect(await trialOfferFor(fakeDb({ plans: PLANS.map((p) => ({ ...p, trial_days: 0 })) }).db, 'u1', 'pro')).toBeNull()
    expect(await trialOfferFor(fakeDb({ plans: PLANS.map((p) => ({ ...p, is_active: false })) }).db, 'u1', 'pro')).toBeNull()
    expect(await trialOfferFor(fakeDb({ used: true }).db, 'u1', 'pro')).toBeNull()
  })
})

describe('grantTrial', () => {
  const offer = { planId: 'pro', planName: 'Pro', days: 14 }
  it('returns the granted trial from the database function', async () => {
    const f = fakeDb({ rpc: { granted: true, days: 14, endsAt: '2026-12-31T00:00:00Z' } })
    expect(await grantTrial(f.db, 'a1', 'u1', offer)).toEqual({ ...offer, days: 14, endsAt: '2026-12-31T00:00:00Z' })
    expect(f.rpc).toHaveBeenCalledWith('grant_trial', { p_account: 'a1', p_user: 'u1', p_plan: 'pro' })
  })
  it('returns null when the database refuses (already used, not free, ...) or errors', async () => {
    expect(await grantTrial(fakeDb({ rpc: { granted: false, reason: 'already_used' } }).db, 'a1', 'u1', offer)).toBeNull()
    const failing = { rpc: async () => ({ data: null, error: { message: 'boom' } }) } as unknown as SupabaseClient
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await grantTrial(failing, 'a1', 'u1', offer)).toBeNull()
  })
})
