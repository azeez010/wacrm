// GET /api/account/billing — plan, usage vs limits, plan catalogue and
// payment history for the signed-in user's account. Any member sees
// plan + usage; history (financial records) is admin+ only (also
// enforced by RLS on subscription_payments).
import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { hasMinRole } from '@/lib/auth/roles';
import { getEntitlements } from '@/lib/billing/entitlements';
import type { LimitKey, PlanRow } from '@/lib/billing/plans';
import { countBillableMessages } from '@/lib/billing/usage';
import { supabaseAdmin } from '@/lib/flows/admin-client';

type Db = Awaited<ReturnType<typeof getCurrentAccount>>['supabase'];

async function count(db: Db, table: string, accountId: string) {
  const { count: n } = await db
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId);
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
    const { supabase: db, accountId, role } = await getCurrentAccount();
    const isAdmin = hasMinRole(role, 'admin');

    const [sub, ents, plansRes, history, counts] = await Promise.all([
      db
        .from('account_subscriptions')
        .select('plan_id, status, billing_interval, current_period_end, provider')
        .eq('account_id', accountId)
        .maybeSingle(),
      getEntitlements(db, accountId),
      db
        .from('plans')
        .select(
          'id, name, description, currency, price_monthly, price_quarterly, price_annual, limits, features, is_featured, sort_order'
        )
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      isAdmin
        ? db
            .from('subscription_payments')
            .select(
              'id, plan_id, amount, currency, status, billing_interval, provider, description, period_start, period_end, created_at'
            )
            .eq('account_id', accountId)
            .order('created_at', { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] as unknown[] }),
      Promise.all([
        count(db, 'contacts', accountId),
        count(db, 'whatsapp_config', accountId),
        count(db, 'automations', accountId),
        count(db, 'flows', accountId),
        count(db, 'pipelines', accountId),
        count(db, 'message_templates', accountId),
        count(db, 'quick_replies', accountId),
        countActiveKeys(db, accountId),
        count(db, 'webhook_endpoints', accountId),
        count(db, 'profiles', accountId),
        countPendingInvites(db, accountId),
      ]),
    ]);

    // The monthly message count uses the service-role client (the SQL function is
    // service-role only); `getCurrentAccount` already proved membership.
    const messagesThisMonth = await countBillableMessages(supabaseAdmin(), accountId);

    const [contacts, connections, automations, flows, pipelines, templates, quickReplies, apiKeys, webhooks, members, pending] =
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
    };

    const usage = (Object.keys(used) as LimitKey[]).map((key) => {
      const l = ents.limits[key];
      return { key, used: used[key] ?? 0, limit: typeof l === 'number' ? l : null };
    });

    const plans = (plansRes.data ?? []) as unknown as PlanRow[];
    const planId = sub.data?.plan_id ?? 'free';
    const lapsed = !sub.data || sub.data.status === 'canceled' || sub.data.status === 'past_due';

    return NextResponse.json({
      can_view_history: isAdmin,
      subscription: sub.data
        ? {
            plan_id: planId,
            status: sub.data.status,
            billing_interval: sub.data.billing_interval,
            current_period_end: sub.data.current_period_end,
            provider: sub.data.provider,
          }
        : { plan_id: 'free', status: 'active', billing_interval: null, current_period_end: null, provider: null },
      effective_plan_name: ents.planName,
      downgraded: lapsed && planId !== 'free',
      features: ents.features,
      usage,
      plans,
      history: history.data ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
