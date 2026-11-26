// /api/v1/deals/[id]
//   GET    one deal                                (pipelines:read)
//   PATCH  edit fields, move stage, set status     (pipelines:write)
// There is deliberately no DELETE - mark a deal "lost" instead.
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { isUuid } from '@/lib/api/v1/pagination';
import { DEAL_SELECT, parsePriority } from '@/lib/api/v1/pipelines';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiKey(request, 'pipelines:read');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Deal not found', 404);
    const { data } = await ctx.supabase
      .from('deals')
      .select(DEAL_SELECT)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!data) return fail('not_found', 'Deal not found', 404);
    return ok(data);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiKey(request, 'pipelines:write');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Deal not found', 404);
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) return fail('bad_request', 'Request body must be valid JSON', 400);

    const { data: deal } = await ctx.supabase
      .from('deals')
      .select('id, pipeline_id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!deal) return fail('not_found', 'Deal not found', 404);

    const patch: Record<string, unknown> = {};
    if (b.title !== undefined) {
      const title = typeof b.title === 'string' ? b.title.trim() : '';
      if (!title || title.length > 200) return fail('bad_request', "'title' must be 1–200 chars", 400);
      patch.title = title;
    }
    if (b.value !== undefined) {
      const v = Number(b.value);
      if (!Number.isFinite(v) || v < 0) return fail('bad_request', "'value' must be a number ≥ 0", 400);
      patch.value = v;
    }
    if (b.notes !== undefined) patch.notes = typeof b.notes === 'string' ? b.notes : null;
    const priority = parsePriority(b.priority);
    if (priority && typeof priority === 'object') return fail('bad_request', priority.error, 400);
    if (priority !== undefined) patch.priority = priority;
    if (b.expected_close_date !== undefined) {
      patch.expected_close_date = typeof b.expected_close_date === 'string' ? b.expected_close_date : null;
    }
    if (b.status !== undefined) {
      if (!['open', 'won', 'lost'].includes(String(b.status))) {
        return fail('bad_request', "'status' must be open, won or lost", 400);
      }
      patch.status = b.status;
    }
    if (b.stage_id !== undefined) {
      if (typeof b.stage_id !== 'string' || !isUuid(b.stage_id)) {
        return fail('bad_request', "'stage_id' must be a UUID", 400);
      }
      const { data: stage } = await ctx.supabase
        .from('pipeline_stages')
        .select('id')
        .eq('id', b.stage_id)
        .eq('pipeline_id', deal.pipeline_id)
        .maybeSingle();
      if (!stage) return fail('bad_request', "stage_id isn't a stage of this deal's pipeline", 400);
      patch.stage_id = b.stage_id;
    }
    if (Object.keys(patch).length === 0) return fail('bad_request', 'Nothing to update', 400);

    const { data, error } = await ctx.supabase
      .from('deals')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(DEAL_SELECT)
      .single();
    if (error) return fail('internal', 'Failed to update deal', 500);
    return ok(data);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
