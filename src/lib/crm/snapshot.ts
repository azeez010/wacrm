import type { SupabaseClient } from '@supabase/supabase-js'
import { getEntitlements } from '@/lib/billing/entitlements'
import { countBillableMessages } from '@/lib/billing/usage'
import { CRM_LISTS, USE_CASE_LISTS } from './attributes'
import type { CrmAttributes, CrmContact } from './types'

const ymd = (iso: string | null | undefined): string | null => (iso ? iso.slice(0, 10) : null)

async function count(db: SupabaseClient, table: string, accountId: string, extra?: (q: any) => any): Promise<number> { // eslint-disable-line @typescript-eslint/no-explicit-any
  let q = db.from(table).select('id', { count: 'exact', head: true }).eq('account_id', accountId)
  if (extra) q = extra(q)
  const { count: n } = await q
  return n ?? 0
}

/**
 * Build the CRM view of one user from the database *now*. Jobs in the outbox
 * only say "sync this user"; reading at flush time means the CRM always gets
 * the latest plan/usage, however many changes were collapsed into one job.
 * Returns null when there is nothing to sync (no such user, or no email).
 */
export async function buildContactSnapshot(db: SupabaseClient, userId: string): Promise<CrmContact | null> {
  const { data: profile } = await db
    .from('profiles')
    .select('user_id, full_name, email, account_id, account_role, locale, country, marketing_opt_in, created_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (!profile?.email) return null

  const full = String(profile.full_name ?? '').trim()
  const [first, ...rest] = full.split(/\s+/)
  const attrs: CrmAttributes = {
    FIRSTNAME: first || null,
    LASTNAME: rest.join(' ') || null,
    OGA_USER_ID: userId,
    ROLE: profile.account_role ?? null,
    LANGUAGE: profile.locale ?? null,
    COUNTRY: profile.country ?? null,
    SIGNED_UP_AT: ymd(profile.created_at as string),
    MARKETING_OPT_IN: Boolean(profile.marketing_opt_in),
  }
  const [{ data: partner }, { count: referred }, { data: referral }] = await Promise.all([
    db.from('partners').select('code').eq('user_id', userId).maybeSingle(),
    db.from('referrals').select('id', { count: 'exact', head: true }).eq('partner_user_id', userId),
    db.from('referrals').select('code').eq('referred_user_id', userId).maybeSingle(),
  ])
  Object.assign(attrs, {
    PARTNER_CODE: (partner?.code as string | null) ?? null,
    REFERRALS_COUNT: referred ?? 0,
    REFERRED_BY: (referral?.code as string | null) ?? null,
  })
  const lists: string[] = [CRM_LISTS.all]
  if (profile.marketing_opt_in) lists.push(CRM_LISTS.marketing)

  const accountId = profile.account_id as string | null
  if (accountId) {
    const [{ data: account }, { data: sub }] = await Promise.all([
      db
        .from('accounts')
        .select('id, timezone, use_cases, heard_from, heard_from_detail, referral_code, onboarded_at')
        .eq('id', accountId)
        .maybeSingle(),
      db
        .from('account_subscriptions')
        .select('plan_id, status, billing_interval, current_period_end')
        .eq('account_id', accountId)
        .maybeSingle(),
    ])
    const [numbers, connected, keys, hooks, members, ents, used, paid] = await Promise.all([
      count(db, 'whatsapp_config', accountId),
      count(db, 'whatsapp_config', accountId, (q) => q.eq('status', 'connected')),
      count(db, 'api_keys', accountId, (q) => q.is('revoked_at', null)),
      count(db, 'webhook_endpoints', accountId),
      count(db, 'profiles', accountId),
      getEntitlements(db, accountId),
      countBillableMessages(db, accountId),
      db.from('subscription_payments').select('amount, net_amount').eq('account_id', accountId).eq('status', 'succeeded').limit(1000),
    ])
    const limit = typeof ents.limits.messages_per_month === 'number' ? ents.limits.messages_per_month : null
    const useCases = (account?.use_cases as string[] | null) ?? []

    Object.assign(attrs, {
      OGA_ACCOUNT_ID: accountId,
      TIMEZONE: account?.timezone ?? null,
      USE_CASES: useCases.join(','),
      HEARD_FROM: account?.heard_from ?? null,
      HEARD_FROM_DETAIL: account?.heard_from_detail ?? null,
      REFERRAL_CODE: account?.referral_code ?? null,
      ONBOARDED_AT: ymd(account?.onboarded_at as string | null),
      PLAN: sub?.plan_id ?? 'free',
      PLAN_STATUS: sub?.status ?? 'active',
      BILLING_INTERVAL: sub?.billing_interval ?? null,
      PLAN_RENEWS_AT: ymd(sub?.current_period_end as string | null),
      LIFETIME_PAID: ((paid.data ?? []) as Array<{ amount: number | string; net_amount: number | string | null }>).reduce((s, r) => s + Number(r.net_amount ?? r.amount), 0),
      WHATSAPP_CONNECTED: connected > 0,
      WHATSAPP_NUMBERS: numbers,
      API_KEYS: keys,
      WEBHOOK_ENDPOINTS: hooks,
      MEMBERS: members,
      MESSAGES_THIS_MONTH: used,
      MESSAGE_LIMIT: limit,
      QUOTA_PERCENT: limit ? Math.round((used / limit) * 100) : 0,
    })
    for (const uc of useCases) if (USE_CASE_LISTS[uc]) lists.push(USE_CASE_LISTS[uc])
  }

  return { externalId: userId, email: String(profile.email).toLowerCase(), attributes: attrs, lists }
}
