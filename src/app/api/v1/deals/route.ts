// /api/v1/deals - deals inside pipelines.
//   GET   list (filter by pipeline_id / stage_id / contact_id / status)  (pipelines:read)
//   POST  create a deal for a contact                                    (pipelines:write)
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseListParams, keysetFilter, buildPage, isUuid } from '@/lib/api/v1/pagination';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import { DEAL_SELECT, parsePriority } from '@/lib/api/v1/pipelines';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'pipelines:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    let query = ctx.supabase.from('deals').select(DEAL_SELECT).eq('account_id', ctx.accountId);
    for (const key of ['pipeline_id', 'stage_id', 'contact_id'] as const) {
      const v = url.searchParams.get(key);
      if (v) {
        if (!isUuid(v)) return fail('bad_request', `'${key}' must be a UUID`, 400);
        query = query.eq(key, v);
      }
    }
    const status = url.searchParams.get('status');
    if (status) {
      if (!['open', 'won', 'lost'].includes(status)) {
        return fail('bad_request', "'status' must be open, won or lost", 400);
      }
      query = query.eq('status', status);
    }
    query = query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) return fail('internal', 'Failed to list deals', 500);
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
    const ctx = await requireApiKey(request, 'pipelines:write');
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) return fail('bad_request', 'Request body must be valid JSON', 400);

    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!title || title.length > 200) return fail('bad_request', "'title' is required (max 200 chars)", 400);
    for (const k of ['pipeline_id', 'stage_id', 'contact_id']) {
      if (typeof b[k] !== 'string' || !isUuid(b[k] as string)) {
        return fail('bad_request', `'${k}' is required and must be a UUID`, 400);
      }
    }
    const value = b.value === undefined ? 0 : Number(b.value);
    if (!Number.isFinite(value) || value < 0) return fail('bad_request', "'value' must be a number ≥ 0", 400);
    const priority = parsePriority(b.priority);
    if (priority && typeof priority === 'object') return fail('bad_request', priority.error, 400);
    if (b.conversation_id !== undefined && b.conversation_id !== null) {
      if (typeof b.conversation_id !== 'string' || !isUuid(b.conversation_id)) {
        return fail('bad_request', "'conversation_id' must be a UUID", 400);
      }
      const { data: conv } = await ctx.supabase
        .from('conversations')
        .select('id')
        .eq('id', b.conversation_id)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!conv) return fail('not_found', 'Conversation not found', 404);
    }

    // Everything referenced must belong to this account, and the stage to this pipeline.
    const [{ data: pipeline }, { data: stage }, { data: contact }, { data: acct }] = await Promise.all([
      ctx.supabase.from('pipelines').select('id').eq('id', b.pipeline_id).eq('account_id', ctx.accountId).maybeSingle(),
      ctx.supabase.from('pipeline_stages').select('id').eq('id', b.stage_id).eq('pipeline_id', b.pipeline_id as string).maybeSingle(),
      ctx.supabase.from('contacts').select('id').eq('id', b.contact_id).eq('account_id', ctx.accountId).maybeSingle(),
      ctx.supabase.from('accounts').select('default_currency').eq('id', ctx.accountId).maybeSingle(),
    ]);
    if (!pipeline) return fail('not_found', 'Pipeline not found', 404);
    if (!stage) return fail('bad_request', 'stage_id does not belong to that pipeline', 400);
    if (!contact) return fail('not_found', 'Contact not found', 404);

    const userId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    const { data, error } = await ctx.supabase
      .from('deals')
      .insert({
        account_id: ctx.accountId,
        user_id: userId,
        pipeline_id: b.pipeline_id,
        stage_id: b.stage_id,
        contact_id: b.contact_id,
        title,
        value,
        currency: acct?.default_currency ?? 'USD',
        notes: typeof b.notes === 'string' ? b.notes : null,
        expected_close_date: typeof b.expected_close_date === 'string' ? b.expected_close_date : null,
        status: 'open',
        priority: priority ?? null,
        conversation_id: typeof b.conversation_id === 'string' ? b.conversation_id : null,
      })
      .select(DEAL_SELECT)
      .single();
    if (error) return fail('internal', 'Failed to create deal', 500);
    return ok(data, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
