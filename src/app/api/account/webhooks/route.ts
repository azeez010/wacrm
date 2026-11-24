// ============================================================
// /api/account/webhooks (dashboard, cookie session)
//
//   GET  - list this account's webhook endpoints (secret never included).
//   POST - register an endpoint. Admin+. The signing secret is returned
//          in plaintext exactly once.
//
// Validation, plan gating and secret handling are shared with the
// public API through src/lib/webhooks/manage.ts.
// ============================================================

import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { FeatureLockedError, PlanLimitError } from '@/lib/billing/entitlements';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import {
  WEBHOOK_PUBLIC_COLUMNS,
  serializeWebhookEndpoint,
} from '@/lib/webhooks/endpoints';
import { createWebhookEndpoint, parseCreateInput } from '@/lib/webhooks/manage';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[GET /api/account/webhooks] fetch error:', error);
      return NextResponse.json({ error: 'Could not load webhooks' }, { status: 500 });
    }
    return NextResponse.json({
      webhooks: (data ?? []).map((r) =>
        serializeWebhookEndpoint(r as Record<string, unknown>)
      ),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:webhookCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }

    const parsed = parseCreateInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.message }, { status: 400 });
    }

    const created = await createWebhookEndpoint(
      ctx.supabase,
      ctx.accountId,
      ctx.userId,
      parsed.value
    );
    if (!created) {
      return NextResponse.json({ error: 'Could not create the webhook' }, { status: 500 });
    }
    return NextResponse.json(
      { webhook: created.endpoint, secret: created.secret },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof PlanLimitError || err instanceof FeatureLockedError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    return toErrorResponse(err);
  }
}
