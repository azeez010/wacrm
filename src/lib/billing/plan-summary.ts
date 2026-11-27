// The plan + limits view the public API and MCP return (GET /api/v1/plan, GET /api/v1/plans).
import type { SupabaseClient } from '@supabase/supabase-js'

import { CANONICAL_ORIGIN } from '@/lib/canonical-host'

import { getEntitlements } from './entitlements'
import { recommendPlan } from './plan-helpers'
import { FEATURE_DEFS, LIMIT_DEFS, type FeatureKey, type LimitKey, type PlanRow } from './plans'
import { buildUsageReport } from './usage-report'

export const UPGRADE_URL = `${CANONICAL_ORIGIN}/settings?tab=billing`
/** A meter counts as "near" its limit from this share on. */
export const NEAR_LIMIT = 0.8

const PUBLIC_PLAN_COLUMNS =
  'id, name, description, currency, price_monthly, price_quarterly, price_annual, limits, features, is_featured, sort_order, trial_days'

export async function activePlans(db: SupabaseClient): Promise<PlanRow[]> {
  const { data } = await db.from('plans').select(PUBLIC_PLAN_COLUMNS).eq('is_active', true).order('sort_order', { ascending: true })
  return (data ?? []) as unknown as PlanRow[]
}

export async function planSummary(db: SupabaseClient, accountId: string, userId: string | null) {
  const [ents, sub] = await Promise.all([
    getEntitlements(db, accountId),
    db
      .from('account_subscriptions')
      .select('plan_id, status, billing_interval, current_period_end, auto_renew')
      .eq('account_id', accountId)
      .maybeSingle(),
  ])
  const { usage, planArchived } = await buildUsageReport(db, accountId, ents.limits, { userId })
  const s = sub.data as { plan_id?: string; status?: string; billing_interval?: string | null; current_period_end?: string | null; auto_renew?: boolean } | null
  const lapsed = !s || s.status === 'canceled' || s.status === 'past_due'
  return {
    plan: {
      id: lapsed ? 'free' : (s?.plan_id ?? 'free'),
      name: ents.planName,
      status: s?.status ?? 'active',
      billing_interval: s?.billing_interval ?? null,
      // the end of the paid period, or of the free trial when status is 'trialing'
      current_period_end: s?.current_period_end ?? null,
      auto_renew: s?.auto_renew === true,
    },
    limits: usage.map((u) => ({
      key: u.key,
      label: LIMIT_DEFS[u.key] ?? u.key,
      used: u.used,
      limit: u.limit,
      near_limit: u.limit !== null && u.limit > 0 && u.used / u.limit >= NEAR_LIMIT && u.used < u.limit,
      at_limit: u.limit !== null && u.used >= u.limit,
      ...(u.held ? { held: u.held } : {}),
    })),
    features: (Object.keys(FEATURE_DEFS) as FeatureKey[]).map((k) => ({ key: k, label: FEATURE_DEFS[k], included: ents.features[k] === true })),
    archived_by_plan: planArchived,
    upgrade_url: UPGRADE_URL,
  }
}

/** Public catalogue, optionally with the plan we would recommend for a limit or feature the caller ran into. */
export function plansView(
  plans: PlanRow[],
  currentId: string,
  why: { limitKey?: LimitKey | null; used?: number; feature?: FeatureKey | null },
) {
  const rec = why.limitKey || why.feature ? recommendPlan(plans, currentId, why) : null
  return {
    current_plan_id: currentId,
    recommended_plan_id: rec?.id ?? null,
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      currency: p.currency,
      price_monthly: Number(p.price_monthly),
      price_quarterly: Number(p.price_quarterly),
      price_annual: Number(p.price_annual),
      trial_days: Number((p as { trial_days?: number }).trial_days ?? 0),
      limits: p.limits,
      features: p.features,
      current: p.id === currentId,
    })),
    upgrade_url: UPGRADE_URL,
  }
}
