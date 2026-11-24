// ============================================================
// GET  /api/v1/webhooks - list webhook endpoints (scope: webhooks:manage)
// POST /api/v1/webhooks - register an endpoint    (scope: webhooks:manage)
//
// POST returns the signing `secret` in plaintext exactly once - store
// it to verify the `X-Wacrm-Signature` on deliveries. wacrm keeps only
// an encrypted copy and can never show it again.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { createWebhookEndpoint, parseCreateInput } from '@/lib/webhooks/manage';
import {
  WEBHOOK_PUBLIC_COLUMNS,
  serializeWebhookEndpoint,
} from '@/lib/webhooks/endpoints';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');

    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api/v1/webhooks] list error:', error);
      return fail('internal', 'Failed to list webhooks', 500);
    }

    // The roster is small and settings-class - return it whole (the
    // list envelope's cursor is always null here).
    return okList(
      (data ?? []).map((r) =>
        serializeWebhookEndpoint(r as Record<string, unknown>)
      ),
      null
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const parsed = parseCreateInput(body);
    if (!parsed.ok) return fail('bad_request', parsed.message, 400);

    const created = await createWebhookEndpoint(
      ctx.supabase,
      ctx.accountId,
      ctx.createdBy,
      parsed.value
    );
    if (!created) {
      return fail('internal', 'Failed to create webhook', 500);
    }

    // Secret shown exactly once.
    return ok({ ...created.endpoint, secret: created.secret }, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
