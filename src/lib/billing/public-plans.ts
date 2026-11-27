import { createClient } from '@supabase/supabase-js'
import type { PlanRow } from './plans'

/** Active plans for public pricing. Anon key + RLS (plans_public_select). */
export async function getPublicPlans(): Promise<PlanRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return []
  const supabase = createClient(url, anon, { auth: { persistSession: false } })
  const { data, error } = await supabase
    .from('plans')
    .select(
      'id, name, description, currency, price_monthly, price_quarterly, price_annual, limits, features, is_featured, sort_order, trial_days, trial_on_signup, promo_quarterly, promo_annual',
    )
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  if (error) {
    console.error('[plans] fetch failed:', error.message)
    return []
  }
  return (data ?? []).map((p) => ({
    ...p,
    price_monthly: Number(p.price_monthly),
    price_quarterly: Number(p.price_quarterly),
    price_annual: Number(p.price_annual),
    trial_days: Number(p.trial_days ?? 0),
    trial_on_signup: p.trial_on_signup === true,
  })) as PlanRow[]
}
