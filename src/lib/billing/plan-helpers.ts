import { DEFAULT_ON_FEATURES, type FeatureKey, type PlanRow } from './plans'

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
