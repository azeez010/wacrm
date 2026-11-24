// POST /api/account/webhooks/{id}/deliveries/{deliveryId}/resend
//
// Re-sends the stored payload of an earlier delivery to the same
// endpoint (admin+). Same event id, fresh signature timestamp, so a
// receiver that dedupes on `id` treats it as a retry. The attempt is
// logged like any other and counts toward the endpoint's health.

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isUuid } from '@/lib/api/v1/pagination';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { deliverAndRecord, type EndpointRow } from '@/lib/webhooks/deliver';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; deliveryId: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id, deliveryId } = await params;
    if (!isUuid(id) || !isUuid(deliveryId)) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 });
    }

    const limit = checkRateLimit(
      `admin:webhookResend:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    // RLS client: proves the caller is an admin of the owning account.
    const { data: delivery } = await ctx.supabase
      .from('webhook_deliveries')
      .select('id, event, payload')
      .eq('id', deliveryId)
      .eq('endpoint_id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!delivery || !delivery.payload) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 });
    }

    // The encrypted signing secret needs the service-role client; the
    // account filter keeps it to this account's endpoint.
    const db = supabaseAdmin();
    const { data: endpoint } = await db
      .from('webhook_endpoints')
      .select('id, url, secret')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!endpoint) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    const result = await deliverAndRecord(
      db,
      ctx.accountId,
      endpoint as EndpointRow,
      delivery.event as string,
      JSON.stringify(delivery.payload),
      Math.floor(Date.now() / 1000),
      delivery.id as string
    );
    return NextResponse.json({
      ok: result.ok,
      status_code: result.statusCode,
      error: result.error,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
