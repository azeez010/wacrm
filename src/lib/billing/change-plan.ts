// ============================================================
// Switch an account's plan. For now this is called by the manual "switch plan" endpoint
// (no payment). When real payments arrive, the payment webhook calls this same function
// after a successful charge, so there is one place that writes the subscription.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { markReferralPaid } from '@/lib/partner/crm-sync'

export type ChangePlanResult = { ok: true; planId: string; planName: string } | { ok: false; error: 'unknown_plan' | 'failed' }

/** `db` must be the service-role client: members cannot write account_subscriptions. */
export async function changePlan(db: SupabaseClient, accountId: string, planId: string): Promise<ChangePlanResult> {
  const { data: plan } = await db.from('plans').select('id, name').eq('id', planId).eq('is_active', true).maybeSingle()
  if (!plan) return { ok: false, error: 'unknown_plan' }

  const { error } = await db.from('account_subscriptions').upsert(
    {
      account_id: accountId,
      plan_id: plan.id,
      status: 'active',
      billing_interval: plan.id === 'free' ? null : 'monthly',
      current_period_end: null,
      provider: null,
    },
    { onConflict: 'account_id' },
  )
  if (error) {
    console.error('[billing] changePlan failed:', error.message)
    return { ok: false, error: 'failed' }
  }
  // A referred account that just went paid: close the referrer's deal as Won (never throws).
  if (plan.id !== 'free') await markReferralPaid(db, accountId)
  return { ok: true, planId: plan.id as string, planName: plan.name as string }
}
