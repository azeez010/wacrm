// PATCH  /api/account/webhooks/{id} - update url / events / is_active (admin+)
// DELETE /api/account/webhooks/{id} - remove an endpoint (admin+)

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isUuid } from '@/lib/api/v1/pagination';
import {
  WEBHOOK_PUBLIC_COLUMNS,
  serializeWebhookEndpoint,
} from '@/lib/webhooks/endpoints';
import { parseUpdateInput } from '@/lib/webhooks/manage';

const NOT_FOUND = { error: 'Webhook not found' };

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }
    const parsed = parseUpdateInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.message }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .update(parsed.value)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .maybeSingle();
    if (error) {
      console.error('[PATCH /api/account/webhooks] update error:', error);
      return NextResponse.json({ error: 'Could not update the webhook' }, { status: 500 });
    }
    if (!data) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({
      webhook: serializeWebhookEndpoint(data as Record<string, unknown>),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });

    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[DELETE /api/account/webhooks] delete error:', error);
      return NextResponse.json({ error: 'Could not delete the webhook' }, { status: 500 });
    }
    if (!data) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ id: data.id, deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
