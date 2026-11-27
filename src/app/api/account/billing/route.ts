// GET /api/account/billing — plan, usage vs limits, plan catalogue and
// payment history for the signed-in user's account. Any member sees
// plan + usage; history (financial records) is admin+ only (also
// enforced by RLS on subscription_payments).
import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { hasMinRole } from '@/lib/auth/roles';
import { getEntitlements } from '@/lib/billing/entitlements';
import type { LimitKey, PlanRow } from '@/lib/billing/plans';
import { countBillableMessages, monthStartUtc } from '@/lib/billing/usage';
import { supabaseAdmin } from '@/lib/flows/admin-client';

type Db = Awaited<ReturnType<typeof getCurrentAccount>>['supabase'];

async function count(db: Db, table: string, accountId: string) {
  const { count: n } = await db
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId);
  return n ?? 0;
}

// Items the plan archived (migration 132) do not count toward the limit; neither do system automations.
async function countLive(db: Db, table: string, accountId: string) {
  let q = db.from(table).select('id', { count: 'exact', head: true }).eq('account_id', accountId).is('plan_archived_at', null);
  if (table === 'automations') q = q.is('system_key', null);
  const { count: n } = await q;
  return n ?? 0;
}

async function countActiveKeys(db: Db, accountId: string) {
  const { count: n } = await db
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .is('revoked_at', null);
  return n ?? 0;
}

async function countPendingInvites(db: Db, accountId: string) {
  const { count: n } = await db
    .from('account_invitations')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString());
  return n ?? 0;
}

export async function GET() {
  try {
    const { supabase: db, accountId, role, userId } = await getCurrentAccount();
    const isAdmin = hasMinRole(role, 'admin');

    const [sub, ents, plansRes, history, counts] = await Promise.all([
      db
        .from('account_subscriptions')
        .select('plan_id, status, billing_interval, current_period_end, provider, auto_renew')
        .eq('account_id', accountId)
        .maybeSingle(),
      getEntitlements(db, accountId),
      db
        .from('plans')
        .select(
          'id, name, description, currency, price_monthly, price_quarterly, price_annual, limits, features, is_featured, sort_order, trial_days, promo_quarterly, promo_annual'
        )
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      isAdmin
        ? db
            .from('subscription_payments')
            .select(
              'id, plan_id, amount, currency, status, billing_interval, provider, description, period_start, period_end, created_at, list_amount, discount_amount, fee_amount, fee_payer, coupons(code)'
            )
            .eq('account_id', accountId)
            .order('created_at', { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] as unknown[] }),
      Promise.all([
        count(db, 'contacts', accountId),
        count(db, 'whatsapp_config', accountId),
        countLive(db, 'automations', accountId),
        countLive(db, 'flows', accountId),
        count(db, 'pipelines', accountId),
        count(db, 'message_templates', accountId),
        countLive(db, 'quick_replies', accountId),
        countActiveKeys(db, accountId),
        countLive(db, 'webhook_endpoints', accountId),
        count(db, 'profiles', accountId),
        countPendingInvites(db, accountId),
        // Forms (not archived) and this month's leads (accepted vs held over the quota).
        db.from('forms').select('id', { count: 'exact', head: true }).eq('account_id', accountId).is('archived_at', null).then((r) => r.count ?? 0),
        Promise.resolve(
          supabaseAdmin().rpc('count_form_submissions', { p_account: accountId, p_since: monthStartUtc().toISOString() })
        ).then((r) => (r.data ?? {}) as { accepted?: number; held?: number }),
      ]),
    ]);

    // The monthly message count uses the service-role client (the SQL function is
    // service-role only); `getCurrentAccount` already proved membership.
    const messagesThisMonth = await countBillableMessages(supabaseAdmin(), accountId);

    const [contacts, connections, automations, flows, pipelines, templates, quickReplies, apiKeys, webhooks, members, pending, formCount, leadCounts] =
      counts;
    const used: Partial<Record<LimitKey, number>> = {
      contacts,
      whatsapp_connections: connections,
      automations,
      flows,
      pipelines,
      templates,
      quick_replies: quickReplies,
      api_keys: apiKeys,
      webhook_endpoints: webhooks,
      seats: members + pending,
      messages_per_month: messagesThisMonth,
      forms_max: formCount,
      form_submissions_per_month: Number(leadCounts.accepted ?? 0),
    };

    const usage = (Object.keys(used) as LimitKey[]).map((key) => {
      const l = ents.limits[key];
      return {
        key,
        used: used[key] ?? 0,
        limit: typeof l === 'number' ? l : null,
        // Leads over the quota are kept but not processed until released or the plan grows.
        ...(key === 'form_submissions_per_month' ? { held: Number(leadCounts.held ?? 0) } : {}),
      };
    });

    // Workspaces are per person: how many they own against the most any of their owned workspaces' plans allows.
    try {
      const { data: allowance } = await db.rpc('owned_workspace_allowance', { p_user: userId });
      const a = allowance as { owned?: number; allowed?: number | null } | null;
      if (a) usage.push({ key: 'workspaces', used: Number(a.owned ?? 0), limit: typeof a.allowed === 'number' ? a.allowed : null });
    } catch {
      /* the meter is informational; never fail the billing page over it */
    }

    // AI credits: a missing plan limit means none (not unlimited), so this comes from the dedicated function.
    try {
      const { data: credit } = await supabaseAdmin().rpc('ai_credit_status', { p_account: accountId });
      const c = credit as { used?: number; limit?: number | null; reason?: string } | null;
      if (c && c.reason !== 'not_member') {
        usage.push({ key: 'ai_tokens_per_month' as LimitKey, used: Number(c.used ?? 0), limit: c.reason === 'plan_feature' ? 0 : typeof c.limit === 'number' ? c.limit : null });
      }
    } catch {
      /* the credit line is informational; never fail the page */
    }

    // What a lower plan archived (restored automatically when there is room again).
    let planArchived: Record<string, number> = {};
    try {
      const { data: pa } = await supabaseAdmin().rpc('plan_archived_summary', { p_account: accountId });
      if (pa && typeof pa === 'object') planArchived = pa as Record<string, number>;
    } catch {
      planArchived = {};
    }

    const plans = (plansRes.data ?? []) as unknown as PlanRow[];
    const planId = sub.data?.plan_id ?? 'free';
    const lapsed = !sub.data || sub.data.status === 'canceled' || sub.data.status === 'past_due';

    // Platform payments (admin console): off = plan changes stay free switches; test/live = real checkout.
    let paymentsMode: 'off' | 'test' | 'live' = 'off';
    try {
      const { data: pm } = await supabaseAdmin().rpc('payment_checkout_settings', { p_account: accountId });
      const m = (pm as { mode?: string } | null)?.mode;
      if (m === 'test' || m === 'live') paymentsMode = m;
    } catch {
      paymentsMode = 'off';
    }

    return NextResponse.json({
      payments_mode: paymentsMode,
      can_view_history: isAdmin,
      subscription: sub.data
        ? {
            plan_id: planId,
            status: sub.data.status,
            billing_interval: sub.data.billing_interval,
            current_period_end: sub.data.current_period_end,
            provider: sub.data.provider,
            auto_renew: (sub.data as { auto_renew?: boolean }).auto_renew === true,
          }
        : { plan_id: 'free', status: 'active', billing_interval: null, current_period_end: null, provider: null },
      effective_plan_name: ents.planName,
      downgraded: lapsed && planId !== 'free',
      features: ents.features,
      usage,
      plan_archived: planArchived,
      plans,
      // What was actually charged, plus the coupon and the fee the customer paid (when there were any).
      history: ((history.data ?? []) as Array<Record<string, unknown>>).map(({ coupons, ...h }) => ({
        ...h,
        coupon_code: (Array.isArray(coupons) ? coupons[0]?.code : (coupons as { code?: string } | null)?.code) ?? null,
        fee_amount: h.fee_payer === 'customer' ? h.fee_amount : 0,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
