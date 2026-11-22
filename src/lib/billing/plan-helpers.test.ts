import { describe, expect, it } from 'vitest'
import { cheapestPlanWith, planHasFeature } from './plan-helpers'

const plan = (id: string, price: number, order: number, features: Record<string, boolean> = {}) => ({ id, price_monthly: price, sort_order: order, features }) as { id: string; price_monthly: number; sort_order: number; features: Record<string, boolean> }

describe('cheapestPlanWith', () => {
  const plans = [plan('pro', 30000, 2, { mcp: true }), plan('free', 0, 0, { mcp: false }), plan('starter', 15000, 1, { mcp: true })]
  it('returns the cheapest plan that has the feature', () => {
    expect(cheapestPlanWith(plans, 'mcp')?.id).toBe('starter')
  })
  it('null when no plan has it', () => {
    expect(cheapestPlanWith([plan('free', 0, 0)], 'mcp')).toBeNull()
  })
  it('ties go to the earlier display order', () => {
    const tie = [plan('b', 10, 2, { mcp: true }), plan('a', 10, 1, { mcp: true })]
    expect(cheapestPlanWith(tie, 'mcp')?.id).toBe('a')
  })
})

describe('planHasFeature', () => {
  it('missing keys are locked, except features that predate the catalogue', () => {
    expect(planHasFeature(plan('x', 0, 0), 'mcp')).toBe(false)
    expect(planHasFeature(plan('x', 0, 0), 'forms')).toBe(true)
    expect(planHasFeature(plan('x', 0, 0, { forms: false }), 'forms')).toBe(false)
  })
})
