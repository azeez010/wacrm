import { DEFAULT_ON_FEATURES, type FeatureKey, type LimitKey, type PlanRow } from './plans'

/** Does this plan include the feature? A missing key means locked, except for features that predate the catalogue. */
export function planHasFeature(plan: Pick<PlanRow, 'features'>, feature: FeatureKey): boolean {
  const v = plan.features?.[feature]
  return v === undefined ? DEFAULT_ON_FEATURES.includes(feature) : v === true
}

/** The cheapest plan that includes a feature (lowest monthly price, then display order), or null. */
export function cheapestPlanWith<P extends Pick<PlanRow, 'features' | 'price_monthly' | 'sort_order'>>(
  plans: readonly P[],
  feature: FeatureKey,
): P | null {
  const withIt = plans.filter((p) => planHasFeature(p, feature))
  withIt.sort((a, b) => Number(a.price_monthly) - Number(b.price_monthly) || a.sort_order - b.sort_order)
  return withIt[0] ?? null
}

type Recommendable = Pick<PlanRow, 'id' | 'features' | 'limits' | 'price_monthly' | 'sort_order'>

/** Does a plan allow more than `used` of a limit? A missing or null limit is unlimited. */
export function planFits(plan: Pick<PlanRow, 'limits'>, key: LimitKey, used: number): boolean {
  const v = plan.limits?.[key]
  return v === undefined || v === null || v > used
}

/**
 * The plan to suggest from the current one: the cheapest plan above it that fixes the reason the person is here
 * (room for one more of `limitKey`, or the locked `feature`); with no reason, simply the next plan up.
 * Null when nothing above the current plan fits (they are already on the best one).
 */
export function recommendPlan<P extends Recommendable>(
  plans: readonly P[],
  currentId: string,
  why: { limitKey?: LimitKey | null; used?: number; feature?: FeatureKey | null } = {},
): P | null {
  const ordered = [...plans].sort((a, b) => a.sort_order - b.sort_order || Number(a.price_monthly) - Number(b.price_monthly))
  const current = ordered.find((p) => p.id === currentId)
  const above = ordered.filter((p) => p.id !== currentId && p.id !== 'free' && (!current || Number(p.price_monthly) > Number(current.price_monthly) || (Number(p.price_monthly) === Number(current.price_monthly) && p.sort_order > current.sort_order)))
  const fits = (p: P) =>
    (why.limitKey ? planFits(p, why.limitKey, why.used ?? current?.limits?.[why.limitKey] ?? 0) : true) &&
    (why.feature ? planHasFeature(p, why.feature) : true)
  return above.find(fits) ?? null
}
