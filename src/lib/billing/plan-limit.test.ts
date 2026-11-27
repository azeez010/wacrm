import { describe, expect, it, vi } from 'vitest'
import { handlePlanLimit, parsePlanLimit, PLAN_LIMIT_EVENT } from './plan-limit'
import { recommendPlan } from './plan-helpers'

describe('parsePlanLimit', () => {
  it('reads our 402 JSON', () => {
    expect(parsePlanLimit({ error: 'x', code: 'plan_limit', limit_key: 'seats', limit: 2 })).toEqual({ limitKey: 'seats', limit: 2 })
  })
  it('reads the database text from triggers and functions, alone or inside an error', () => {
    expect(parsePlanLimit('plan_limit:workspaces:1')).toEqual({ limitKey: 'workspaces', limit: 1 })
    expect(parsePlanLimit({ message: 'plan_limit:contacts:250', code: 'P0001' })).toEqual({ limitKey: 'contacts', limit: 250 })
    expect(parsePlanLimit(new Error('insert failed: plan_limit:contacts:500'))).toEqual({ limitKey: 'contacts', limit: 500 })
    expect(parsePlanLimit({ code: 'plan_limit', error: 'plan_limit:forms_max:3' })).toEqual({ limitKey: 'forms_max', limit: 3 })
  })
  it('accepts the older { upgrade: true } shape with no specific limit', () => {
    expect(parsePlanLimit({ error: 'Upgrade', upgrade: true })).toEqual({ limitKey: null, limit: null })
  })
  it('ignores everything else', () => {
    for (const x of [null, undefined, 42, '', 'Network error', { error: 'nope' }, { code: 'quota_exceeded' }, new Error('boom')]) {
      expect(parsePlanLimit(x)).toBeNull()
    }
  })
  it('handlePlanLimit opens the dialog only for plan limits', () => {
    // Tests run in node: a minimal window is enough for dispatchEvent.
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    const seen = vi.fn()
    target.addEventListener(PLAN_LIMIT_EVENT, (e) => seen((e as CustomEvent).detail))
    expect(handlePlanLimit({ error: 'other' })).toBe(false)
    expect(handlePlanLimit({ code: 'plan_limit', limit_key: 'api_keys', limit: 1 })).toBe(true)
    expect(seen).toHaveBeenCalledWith({ limitKey: 'api_keys', limit: 1 })
    expect(seen).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})

describe('recommendPlan', () => {
  const plans = [
    { id: 'free', price_monthly: 0, sort_order: 0, limits: { workspaces: 1, seats: 2, contacts: 250 }, features: {} },
    { id: 'starter', price_monthly: 15000, sort_order: 1, limits: { workspaces: 3, seats: 5, contacts: 5000 }, features: { broadcasts: true } },
    { id: 'pro', price_monthly: 45000, sort_order: 2, limits: { workspaces: 10, seats: 25, contacts: null }, features: { broadcasts: true, mcp: true } },
  ]
  it('suggests the cheapest plan above the current one that makes room for one more', () => {
    expect(recommendPlan(plans, 'free', { limitKey: 'workspaces', used: 1 })?.id).toBe('starter')
    expect(recommendPlan(plans, 'starter', { limitKey: 'workspaces', used: 3 })?.id).toBe('pro')
    expect(recommendPlan(plans, 'free', { limitKey: 'contacts', used: 6000 })?.id).toBe('pro') // starter is too small
  })
  it('suggests the cheapest plan with a locked feature', () => {
    expect(recommendPlan(plans, 'free', { feature: 'mcp' })?.id).toBe('pro')
    expect(recommendPlan(plans, 'free', { feature: 'broadcasts' })?.id).toBe('starter')
  })
  it('without a reason, the next plan up; on the top plan, nothing', () => {
    expect(recommendPlan(plans, 'free')?.id).toBe('starter')
    expect(recommendPlan(plans, 'starter')?.id).toBe('pro')
    expect(recommendPlan(plans, 'pro')).toBeNull()
    expect(recommendPlan(plans, 'pro', { limitKey: 'workspaces', used: 10 })).toBeNull()
  })
  it('never suggests Free or the current plan', () => {
    expect(recommendPlan(plans, 'starter', { limitKey: 'seats', used: 0 })?.id).toBe('pro')
  })
})

describe('which failed requests are checked for a plan limit', async () => {
  const { isLimitCandidate } = await import('@/components/billing/upgrade-host')
  const origin = 'https://ogadesk.com'
  const sb = 'https://abc.supabase.co'
  it('checks our own API and the database client on 4xx only', () => {
    expect(isLimitCandidate('/api/account/invitations', 402, origin, sb)).toBe(true)
    expect(isLimitCandidate('https://ogadesk.com/api/forms', 400, origin, sb)).toBe(true)
    expect(isLimitCandidate('https://abc.supabase.co/rest/v1/rpc/create_workspace', 400, origin, sb)).toBe(true)
  })
  it('ignores successes, server errors and other sites', () => {
    expect(isLimitCandidate('/api/forms', 200, origin, sb)).toBe(false)
    expect(isLimitCandidate('/api/forms', 500, origin, sb)).toBe(false)
    expect(isLimitCandidate('https://api.paystack.co/x', 402, origin, sb)).toBe(false)
    expect(isLimitCandidate('https://ogadesk.com/settings', 404, origin, sb)).toBe(false)
    expect(isLimitCandidate('https://abc.supabase.co/x', 400, origin, undefined)).toBe(false)
  })
})
