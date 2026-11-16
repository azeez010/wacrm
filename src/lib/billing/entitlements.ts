import type { SupabaseClient } from '@supabase/supabase-js'
import { LIMIT_DEFS, type FeatureKey, type LimitKey, type PlanRow } from './plans'

export class PlanLimitError extends Error {
  readonly status = 402 as const
  constructor(
    readonly limitKey: LimitKey,
    readonly limit: number,
    readonly planName: string,
  ) {
    super(
      `Your ${planName} plan allows ${limit} ${LIMIT_DEFS[limitKey].toLowerCase()}. Upgrade to add more.`,
    )
    this.name = 'PlanLimitError'
  }
}

export class FeatureLockedError extends Error {
  readonly status = 402 as const
  constructor(
    readonly feature: FeatureKey,
    readonly planName: string,
  ) {
    super(`${feature.replace(/_/g, ' ')} isn't included in your ${planName} plan.`)
    this.name = 'FeatureLockedError'
  }
}

type Effective = {
  planName: string
  limits: Record<string, number | null | undefined>
  features: Record<string, boolean | undefined>
}

/** Effective plan: subscription row + plan row + per-account overrides. */
export async function getEntitlements(
  supabase: SupabaseClient,
  accountId: string,
): Promise<Effective> {
  const { data: sub } = await supabase
    .from('account_subscriptions')
    .select('plan_id, status, limit_overrides, feature_overrides')
    .eq('account_id', accountId)
    .maybeSingle()

  const lapsed = !sub || sub.status === 'canceled' || sub.status === 'past_due'
  const planId = lapsed ? 'free' : sub.plan_id
  const { data: plan } = await supabase
    .from('plans')
    .select('name, limits, features')
    .eq('id', planId)
    .maybeSingle<Pick<PlanRow, 'limits' | 'features'> & { name: string }>()

  return {
    planName: plan?.name ?? 'Free',
    limits: { ...(plan?.limits ?? {}), ...(sub?.limit_overrides ?? {}) },
    features: { ...(plan?.features ?? {}), ...(sub?.feature_overrides ?? {}) },
  }
}

/** Missing key = unlimited; explicit null = unlimited. */
export async function getLimit(supabase: SupabaseClient, accountId: string, key: LimitKey) {
  const e = await getEntitlements(supabase, accountId)
  const v = e.limits[key]
  return { planName: e.planName, limit: typeof v === 'number' ? v : null }
}

export async function assertWithinLimit(
  supabase: SupabaseClient,
  accountId: string,
  key: LimitKey,
  currentCount: number,
) {
  const { planName, limit } = await getLimit(supabase, accountId, key)
  if (limit !== null && currentCount >= limit) throw new PlanLimitError(key, limit, planName)
}

export async function assertFeature(
  supabase: SupabaseClient,
  accountId: string,
  feature: FeatureKey,
) {
  const e = await getEntitlements(supabase, accountId)
  if (e.features[feature] === false || e.features[feature] === undefined) {
    throw new FeatureLockedError(feature, e.planName)
  }
}

export async function assertCanAddWhatsAppConnection(supabase: SupabaseClient, accountId: string) {
  const { count } = await supabase
    .from('whatsapp_config')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
  await assertWithinLimit(supabase, accountId, 'whatsapp_connections', count ?? 0)
}

/** Seats = members + pending invitations. */
export async function assertCanAddSeat(supabase: SupabaseClient, accountId: string) {
  const [{ count: members }, { count: pending }] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
    supabase
      .from('account_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString()),
  ])
  await assertWithinLimit(supabase, accountId, 'seats', (members ?? 0) + (pending ?? 0))
}
