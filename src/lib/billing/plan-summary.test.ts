import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({}) }))
import { plansView } from './plan-summary'
import type { PlanRow } from './plans'

const plan = (id: string, sort: number, price: number, limits: Record<string, number | null>) =>
  ({ id, name: id, description: null, currency: 'NGN', price_monthly: price, price_quarterly: price * 3, price_annual: price * 12, limits, features: {}, is_featured: false, sort_order: sort }) as unknown as PlanRow

const PLANS = [plan('free', 0, 0, { forms_max: 2 }), plan('starter', 1, 15000, { forms_max: 10 }), plan('pro', 2, 45000, { forms_max: null })]

describe('plansView', () => {
  it('recommends the cheapest plan above the current one that fits the need', () => {
    expect(plansView(PLANS, 'free', { limitKey: 'forms_max', used: 5 }).recommended_plan_id).toBe('starter')
    expect(plansView(PLANS, 'free', { limitKey: 'forms_max', used: 30 }).recommended_plan_id).toBe('pro')
  })

  it('recommends nothing without a reason, and marks the current plan', () => {
    const v = plansView(PLANS, 'starter', {})
    expect(v.recommended_plan_id).toBeNull()
    expect(v.plans.find((p) => p.current)?.id).toBe('starter')
    expect(v.upgrade_url).toContain('/settings?tab=billing')
  })
})
