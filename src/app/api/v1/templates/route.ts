// ============================================================
// /api/v1/templates — public API for message templates.
//
//   GET  list templates + approval status      (templates:read)
//   POST create a template and submit it to Meta (templates:write)
//
// POST needs the account to have a WhatsApp connection (it is
// submitted to that connection's WABA). With more than one
// connection, pass `whatsapp_config_id`. Reuses the same submit
// pipeline as the dashboard, so validation and Meta behaviour match.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseListParams, keysetFilter, buildPage } from '@/lib/api/v1/pagination';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import { submitTemplateForAccount } from '@/lib/whatsapp/template-submit';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

const TEMPLATE_SELECT =
  'id, name, category, language, status, header_type, header_content, body_text, footer_text, buttons, sample_values, meta_template_id, rejection_reason, submission_error, whatsapp_config_id, last_submitted_at, created_at';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'templates:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    let query = ctx.supabase
      .from('message_templates')
      .select(TEMPLATE_SELECT)
      .eq('account_id', ctx.accountId);
    if (status) query = query.eq('status', status.toUpperCase());
    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);
    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[GET /api/v1/templates]', error);
      return fail('internal', 'Failed to list templates', 500);
    }
    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(items, nextCursor);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'templates:write');

    let payload: TemplatePayload;
    try {
      payload = (await request.json()) as TemplatePayload;
    } catch {
      return fail('bad_request', 'Request body must be valid JSON', 400);
    }
    if (!payload || typeof payload !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const userId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    const res = await submitTemplateForAccount(
      ctx.supabase,
      ctx.accountId,
      userId,
      payload
    );
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      template?: unknown;
      dry_run?: boolean;
    };

    if (!res.ok) {
      const code =
        res.status === 429
          ? 'rate_limited'
          : res.status === 409
            ? 'conflict'
            : res.status >= 500
              ? res.status === 502
                ? 'meta_error'
                : 'internal'
              : 'bad_request';
      return fail(code, body.error ?? 'Template submission failed', res.status);
    }
    return ok(body.template, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
