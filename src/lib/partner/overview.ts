import type { SupabaseClient } from '@supabase/supabase-js'
import { SITE_URL } from '@/lib/seo'
import { ensurePartner } from './code'
import type { CrmConfig } from './input'

type Db = SupabaseClient

export interface PartnerOverview {
  code: string
  link: string
  displayName: string | null
  showOnLeaderboard: boolean
  payoutDetails: Record<string, unknown>
  settings: { enabled: boolean; commissionPercent: number; recurringMonths: number; minPayout: number; currency: string }
  stats: { clicks: number; signups: number; customers: number; byPlan: Record<string, number> }
  crmConfig: CrmConfig
  referrals: Array<{
    id: string
    name: string
    email: string
    phone: string | null
    plan: string
    paid: boolean
    at: string
    crmContactId: string | null
  }>
  report: Array<{ month: string; count: number }>
  materials: Array<{ id: string; title: string; kind: string; description: string | null; url: string; imageUrl: string | null; sizeLabel: string | null }>
  leaderboard: Array<{ rank: number; name: string; referrals: number; isYou: boolean }>
}

/** Everything the partner page shows, built with the service-role client. */
export async function buildPartnerOverview(db: Db, userId: string): Promise<PartnerOverview> {
  const { data: prof } = await db.from('profiles').select('full_name').eq('user_id', userId).maybeSingle()
  const partner = await ensurePartner(db, userId, (prof?.full_name as string | null) ?? null)

  const [settingsRes, refsRes, matsRes, boardRes] = await Promise.all([
    db.from('partner_settings').select('enabled, commission_percent, recurring_months, min_payout, currency').eq('id', 1).maybeSingle(),
    db
      .from('referrals')
      .select('id, referred_user_id, referred_account_id, created_at, crm_contact_id')
      .eq('partner_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(500),
    db
      .from('partner_materials')
      .select('id, title, kind, description, url, image_url, size_label')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    db.rpc('partner_leaderboard', { p_limit: 20 }),
  ])

  const refs = (refsRes.data ?? []) as Array<{ id: string; referred_user_id: string; referred_account_id: string | null; created_at: string; crm_contact_id: string | null }>
  const userIds = refs.map((r) => r.referred_user_id)
  const accountIds = [...new Set(refs.map((r) => r.referred_account_id).filter(Boolean))] as string[]
  const [people, subs] = await Promise.all([
    userIds.length ? db.from('profiles').select('user_id, email, full_name, phone').in('user_id', userIds) : Promise.resolve({ data: [] }),
    accountIds.length ? db.from('account_subscriptions').select('account_id, plan_id, status').in('account_id', accountIds) : Promise.resolve({ data: [] }),
  ])
  const personBy = new Map(((people.data ?? []) as Array<{ user_id: string; email: string; full_name: string | null; phone: string | null }>).map((p) => [p.user_id, p]))
  const planBy = new Map(((subs.data ?? []) as Array<{ account_id: string; plan_id: string; status: string }>).map((s) => [s.account_id, s.status === 'active' || s.status === 'trialing' ? s.plan_id : 'free']))

  const referrals = refs.map((r) => ({
    id: r.id,
    name: personBy.get(r.referred_user_id)?.full_name || '',
    email: personBy.get(r.referred_user_id)?.email || '',
    phone: personBy.get(r.referred_user_id)?.phone ?? null,
    plan: (r.referred_account_id && planBy.get(r.referred_account_id)) || 'free',
    paid: Boolean(r.referred_account_id && (planBy.get(r.referred_account_id) ?? 'free') !== 'free'),
    at: r.created_at,
    crmContactId: r.crm_contact_id ?? null,
  }))
  const byPlan: Record<string, number> = {}
  const byMonth: Record<string, number> = {}
  for (const r of referrals) {
    byPlan[r.plan] = (byPlan[r.plan] ?? 0) + 1
    const m = r.at.slice(0, 7)
    byMonth[m] = (byMonth[m] ?? 0) + 1
  }

  const s = settingsRes.data as { enabled: boolean; commission_percent: number | string; recurring_months: number; min_payout: number | string; currency: string } | null
  const board = ((boardRes.data ?? []) as Array<{ user_id: string; display_name: string; referrals: number | string }>).map((b, i) => ({
    rank: i + 1,
    name: b.display_name,
    referrals: Number(b.referrals),
    isYou: b.user_id === userId,
  }))

  return {
    code: partner.code,
    link: `${SITE_URL}/signup?ref=${partner.code}`,
    displayName: partner.display_name,
    showOnLeaderboard: partner.show_on_leaderboard,
    payoutDetails: partner.payout_details ?? {},
    crmConfig: (partner.crm_config ?? {}) as CrmConfig,
    settings: {
      enabled: s?.enabled ?? true,
      commissionPercent: Number(s?.commission_percent ?? 20),
      recurringMonths: s?.recurring_months ?? 12,
      minPayout: Number(s?.min_payout ?? 50),
      currency: s?.currency ?? 'USD',
    },
    stats: {
      clicks: Number(partner.clicks ?? 0),
      signups: refs.length,
      // Referrals on a paid plan (stays 0 until payments exist).
      customers: referrals.filter((r) => r.plan !== 'free').length,
      byPlan,
    },
    referrals: referrals.slice(0, 100),
    report: Object.entries(byMonth).sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, 12).map(([month, count]) => ({ month, count })),
    materials: ((matsRes.data ?? []) as Array<{ id: string; title: string; kind: string; description: string | null; url: string; image_url: string | null; size_label: string | null }>).map((m) => ({
      id: m.id,
      title: m.title,
      kind: m.kind,
      description: m.description,
      url: m.url,
      imageUrl: m.image_url,
      sizeLabel: m.size_label,
    })),
    leaderboard: board,
  }
}
