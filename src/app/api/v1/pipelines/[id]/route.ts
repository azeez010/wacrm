// /api/v1/pipelines/[id]
//   GET     one pipeline + stages                     (pipelines:read)
//   PATCH   rename and/or replace the stage list      (pipelines:write)
//   DELETE  delete pipeline (and its deals!)          (pipelines:write)
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { isUuid } from '@/lib/api/v1/pagination';
import { normalizeStages } from '@/lib/api/v1/pipelines';

type Ctx = { params: Promise<{ id: string }> };

async function load(ctx: Awaited<ReturnType<typeof requireApiKey>>, id: string) {
  const { data: pipeline } = await ctx.supabase
    .from('pipelines')
    .select('id, name, created_at')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (!pipeline) return null;
  const { data: stages } = await ctx.supabase
    .from('pipeline_stages')
    .select('id, name, color, position')
    .eq('pipeline_id', id)
    .order('position', { ascending: true });
  return { ...pipeline, stages: stages ?? [] };
}

export async function GET(request: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiKey(request, 'pipelines:read');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Pipeline not found', 404);
    const p = await load(ctx, id);
    if (!p) return fail('not_found', 'Pipeline not found', 404);
    return ok(p);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiKey(request, 'pipelines:write');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Pipeline not found', 404);
    const existing = await load(ctx, id);
    if (!existing) return fail('not_found', 'Pipeline not found', 404);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; stages?: unknown }
      | null;
    if (!body) return fail('bad_request', 'Request body must be valid JSON', 400);

    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 80) return fail('bad_request', "'name' must be 1–80 chars", 400);
      const { error } = await ctx.supabase.from('pipelines').update({ name }).eq('id', id);
      if (error) return fail('internal', 'Failed to rename pipeline', 500);
    }

    if (body.stages !== undefined) {
      const stages = normalizeStages(body.stages);
      if (typeof stages === 'string') return fail('bad_request', stages, 400);
      const existingIds = new Set(existing.stages.map((s) => s.id as string));
      const keepIds = new Set(stages.filter((s) => s.id && existingIds.has(s.id)).map((s) => s.id!));

      // Remove stages that were left out. A stage that still holds deals
      // can't be deleted (deals.stage_id has no cascade) - say so clearly
      // instead of leaving the pipeline half-edited.
      const removed = [...existingIds].filter((sid) => !keepIds.has(sid));
      if (removed.length > 0) {
        const { count } = await ctx.supabase
          .from('deals')
          .select('id', { count: 'exact', head: true })
          .in('stage_id', removed);
        if ((count ?? 0) > 0) {
          return fail(
            'conflict',
            `Can't remove ${removed.length} stage(s) that still contain ${count} deal(s). Move those deals to another stage first.`,
            409
          );
        }
        const { error } = await ctx.supabase.from('pipeline_stages').delete().in('id', removed);
        if (error) return fail('internal', 'Failed to remove stages', 500);
      }

      for (let i = 0; i < stages.length; i++) {
        const s = stages[i];
        if (s.id && existingIds.has(s.id)) {
          const { error } = await ctx.supabase
            .from('pipeline_stages')
            .update({ name: s.name, color: s.color, position: i })
            .eq('id', s.id)
            .eq('pipeline_id', id);
          if (error) return fail('internal', 'Failed to update stages', 500);
        } else {
          const { error } = await ctx.supabase
            .from('pipeline_stages')
            .insert({ pipeline_id: id, name: s.name, color: s.color, position: i });
          if (error) return fail('internal', 'Failed to add stages', 500);
        }
      }
    }

    return ok(await load(ctx, id));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiKey(request, 'pipelines:write');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Pipeline not found', 404);
    const { data, error } = await ctx.supabase
      .from('pipelines')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id');
    if (error) return fail('internal', 'Failed to delete pipeline', 500);
    if (!data || data.length === 0) return fail('not_found', 'Pipeline not found', 404);
    return ok({ id, deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
