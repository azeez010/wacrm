import type { SupabaseClient } from '@supabase/supabase-js'
import { isValidPlanId } from '@/lib/plan-intent'

/** A free trial of a paid plan. Lengths and which plan are set in the admin console (plans.trial_days / trial_on_signup). */
export interface TrialOffer {
  planId: string
  planName: string
  days: number
}

type PlanTrialRow = { id: string; name: string; trial_days: number }

async function trialPlan(db: SupabaseClient, filter: { id: string } | { onSignup: true }): Promise<TrialOffer | null> {
  let q = db.from('plans').select('id, name, trial_days').eq('is_active', true).gt('trial_days', 0).neq('id', 'free')
  q = 'id' in filter ? q.eq('id', filter.id) : q.eq('trial_on_signup', true)
  const { data } = await q.limit(1).maybeSingle()
  const p = data as PlanTrialRow | null
  return p ? { planId: p.id, planName: p.name, days: Number(p.trial_days) } : null
}

/**
 * The trial a new workspace owner is offered: the plan they clicked on the pricing page when it has a trial,
 * otherwise the plan marked "default trial for new signups", otherwise none. One trial per person: someone who
 * already had one is offered nothing. (grant_trial is the authority; it also stops re-signing up with an email alias.)
 */
export async function trialOfferFor(db: SupabaseClient, userId: string, planHint?: string | null): Promise<TrialOffer | null> {
  const { data: used } = await db.from('trial_grants').select('id').eq('user_id', userId).maybeSingle()
  if (used) return null
  if (isValidPlanId(planHint)) {
    const chosen = await trialPlan(db, { id: planHint })
    if (chosen) return chosen
  }
  return trialPlan(db, { onSignup: true })
}

export interface GrantedTrial extends TrialOffer {
  endsAt: string
}

/** Starts the trial on the account (service role). Null when it was not granted (already used, not free, ...). */
export async function grantTrial(db: SupabaseClient, accountId: string, userId: string, offer: TrialOffer): Promise<GrantedTrial | null> {
  const { data, error } = await db.rpc('grant_trial', { p_account: accountId, p_user: userId, p_plan: offer.planId })
  if (error) {
    console.error('[trial] grant failed:', error.message)
    return null
  }
  const r = data as { granted?: boolean; endsAt?: string; days?: number } | null
  if (!r?.granted || !r.endsAt) return null
  return { ...offer, days: Number(r.days ?? offer.days), endsAt: r.endsAt }
}
