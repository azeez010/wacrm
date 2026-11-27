// GET /api/account/billing — plan, usage vs limits, plan catalogue and
// payment history for the signed-in user's account. Any member sees
// plan + usage; history (financial records) is admin+ only (also
// enforced by RLS on subscription_payments).
import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { hasMinRole } from '@/lib/auth/roles';
import { getEntitlements } from '@/lib/billing/entitlements';
import type { PlanRow } from '@/lib/billing/plans';
import { buildUsageReport } from '@/lib/billing/usage-report';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function GET() {
  try {
    const { supabase: db, accountId, role, userId } = await getCurrentAccount();
    const isAdmin = hasMinRole(role, 'admin');

    const [sub, ents, plansRes, history] = await Promise.all([
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
    ]);

    const { usage, planArchived } = await buildUsageReport(db, accountId, ents.limits, { userId });

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
