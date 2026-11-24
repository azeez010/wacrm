// ============================================================
// GET    /api/v1/webhooks/{id} - read an endpoint   (webhooks:manage)
// PATCH  /api/v1/webhooks/{id} - update url/events/is_active
// DELETE /api/v1/webhooks/{id} - remove an endpoint
//
// All account-scoped: a foreign id → 404 (never 403). The signing
// secret is never returned here - it's shown once at creation only.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { isUuid } from '@/lib/api/v1/pagination';
import { parseUpdateInput } from '@/lib/webhooks/manage';
import {
  WEBHOOK_PUBLIC_COLUMNS,
  serializeWebhookEndpoint,
} from '@/lib/webhooks/endpoints';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Webhook not found', 404);

    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/webhooks] read error:', error);
      return fail('internal', 'Failed to read webhook', 500);
    }
    if (!data) return fail('not_found', 'Webhook not found', 404);

    return ok(serializeWebhookEndpoint(data as Record<string, unknown>));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Webhook not found', 404);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const parsed = parseUpdateInput(body);
    if (!parsed.ok) return fail('bad_request', parsed.message, 400);
    const updates = parsed.value;

    // Scope the update by account_id so a foreign id touches nothing;
    // the returned row (null when unmatched) drives the 404.
    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/webhooks] update error:', error);
      return fail('internal', 'Failed to update webhook', 500);
    }
    if (!data) return fail('not_found', 'Webhook not found', 404);

    return ok(serializeWebhookEndpoint(data as Record<string, unknown>));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Webhook not found', 404);

    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[api/v1/webhooks] delete error:', error);
      return fail('internal', 'Failed to delete webhook', 500);
    }
    if (!data) return fail('not_found', 'Webhook not found', 404);

    return ok({ id: data.id, deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
