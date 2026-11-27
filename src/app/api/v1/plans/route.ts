// GET /api/v1/plans - the public plan catalogue (prices, limits, features, trial days). With ?limit_key=<key>
// (and optional &used=<n>) or ?feature=<key> it also names the cheapest plan above the current one that fits.
// Needs a valid key, no scope.
import { requireApiKey } from '@/lib/auth/api-context'
import { getEntitlements } from '@/lib/billing/entitlements'
import { activePlans, plansView } from '@/lib/billing/plan-summary'
import { FEATURE_DEFS, LIMIT_DEFS, type FeatureKey, type LimitKey } from '@/lib/billing/plans'
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond'

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request)
    const q = new URL(request.url).searchParams
    const limitKey = q.get('limit_key')
    const feature = q.get('feature')
    const usedRaw = q.get('used')
    if (limitKey && !(limitKey in LIMIT_DEFS)) return fail('bad_request', `Unknown limit_key '${limitKey}'`, 400)
    if (feature && !(feature in FEATURE_DEFS)) return fail('bad_request', `Unknown feature '${feature}'`, 400)
    const used = usedRaw === null ? undefined : Number(usedRaw)
    if (used !== undefined && (!Number.isFinite(used) || used < 0)) return fail('bad_request', 'used must be a number >= 0', 400)

    const [plans, ents, sub] = await Promise.all([
      activePlans(ctx.supabase),
      getEntitlements(ctx.supabase, ctx.accountId),
      ctx.supabase.from('account_subscriptions').select('plan_id, status').eq('account_id', ctx.accountId).maybeSingle(),
    ])
    const s = sub.data as { plan_id?: string; status?: string } | null
    const currentId = !s || s.status === 'canceled' || s.status === 'past_due' ? 'free' : (s.plan_id ?? 'free')
    // Without an explicit count, "fits" means more room than the current limit.
    const current = limitKey ? ents.limits[limitKey as LimitKey] : undefined
    return ok(
      plansView(plans, currentId, {
        limitKey: (limitKey as LimitKey) || null,
        used: used ?? (typeof current === 'number' ? current : undefined),
        feature: (feature as FeatureKey) || null,
      }),
    )
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
