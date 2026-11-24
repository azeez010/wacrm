// GET /api/account/webhooks/{id}/deliveries - recent delivery attempts
// (admin+; payloads carry customer data). Newest first, last 14 days.

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isUuid } from '@/lib/api/v1/pagination';

const LIST_LIMIT = 50;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }
    const failedOnly = new URL(request.url).searchParams.get('failed') === '1';

    let q = ctx.supabase
      .from('webhook_deliveries')
      .select(
        'id, event, event_id, ok, status_code, duration_ms, error, response_snippet, payload, resent_from, created_at'
      )
      .eq('account_id', ctx.accountId)
      .eq('endpoint_id', id)
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT);
    if (failedOnly) q = q.eq('ok', false);

    const { data, error } = await q;
    if (error) {
      console.error('[GET /api/account/webhooks/deliveries] error:', error);
      return NextResponse.json({ error: 'Could not load deliveries' }, { status: 500 });
    }
    return NextResponse.json({ deliveries: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
