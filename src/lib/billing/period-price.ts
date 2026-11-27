import type { PlanRow } from './plans'

export type Period = 'monthly' | 'quarterly' | 'annual'
export const PERIODS: Period[] = ['monthly', 'quarterly', 'annual']
export const PERIOD_MONTHS: Record<Period, number> = { monthly: 1, quarterly: 3, annual: 12 }

type Prices = Pick<PlanRow, 'price_monthly' | 'price_quarterly' | 'price_annual'>

/** What the customer is charged once per billing period. 0 when the plan has no price for it. */
export function periodTotal(plan: Prices, period: Period): number {
  const v = period === 'monthly' ? plan.price_monthly : period === 'quarterly' ? plan.price_quarterly : plan.price_annual
  return Number.isFinite(v) && v > 0 ? v : 0
}

/** The period's price spread over its months, so every period reads as "per month". */
export function perMonth(plan: Prices, period: Period): number {
  return periodTotal(plan, period) / PERIOD_MONTHS[period]
}

/** Whole-percent saving against paying monthly (0 when there is none, or the data is unusable). */
export function savingsPercent(plan: Prices, period: Period): number {
  const monthly = plan.price_monthly
  const total = periodTotal(plan, period)
  if (period === 'monthly' || !(monthly > 0) || total === 0) return 0
  const pct = Math.round((1 - total / (monthly * PERIOD_MONTHS[period])) * 100)
  return pct > 0 ? pct : 0
}

/** Periods worth offering: monthly always, the others only if some plan actually prices them. */
export function availablePeriods(plans: Prices[]): Period[] {
  return PERIODS.filter((p) => p === 'monthly' || plans.some((pl) => periodTotal(pl, p) > 0))
}

/** The biggest saving any plan offers for a period, for the "Save N%" chip. */
export function bestSavings(plans: Prices[], period: Period): number {
  return plans.reduce((max, pl) => Math.max(max, savingsPercent(pl, period)), 0)
}
