// /api/v1/pipelines - sales (deals) and support (tickets) pipelines and their stages.
//   GET   list pipelines with stages      (pipelines:read)
//   POST  create a pipeline with stages   (pipelines:write)
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import { assertWithinLimit, PlanLimitError } from '@/lib/billing/entitlements';
import {
  normalizeStages,
  defaultStagesFor,
  PIPELINE_SELECT,
} from '@/lib/api/v1/pipelines';
import { isPipelineKind } from '@/lib/pipelines/kinds';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'pipelines:read');
    const { data: pipelines, error } = await ctx.supabase
      .from('pipelines')
      .select(PIPELINE_SELECT)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true });
    if (error) return fail('internal', 'Failed to list pipelines', 500);

    const ids = (pipelines ?? []).map((p) => p.id);
    const stagesByPipeline = new Map<string, unknown[]>();
    if (ids.length > 0) {
      const { data: stages } = await ctx.supabase
        .from('pipeline_stages')
        .select('id, pipeline_id, name, color, position, outcome')
        .in('pipeline_id', ids)
        .order('position', { ascending: true });
      for (const s of stages ?? []) {
        const list = stagesByPipeline.get(s.pipeline_id) ?? [];
        list.push({ id: s.id, name: s.name, color: s.color, position: s.position, outcome: s.outcome ?? null });
        stagesByPipeline.set(s.pipeline_id, list);
      }
    }
    return ok(
      (pipelines ?? []).map((p) => ({ ...p, stages: stagesByPipeline.get(p.id) ?? [] }))
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'pipelines:write');
    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; stages?: unknown; kind?: unknown }
      | null;
    const kind = body?.kind ?? 'sales';
    if (!isPipelineKind(kind)) {
      return fail('bad_request', "'kind' must be \"sales\" or \"support\"", 400);
    }
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) {
      return fail('bad_request', "'name' is required (max 80 chars)", 400);
    }
    const stages = normalizeStages(body?.stages ?? defaultStagesFor(kind));
    if (typeof stages === 'string') return fail('bad_request', stages, 400);

    const { count } = await ctx.supabase
      .from('pipelines')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId);
    await assertWithinLimit(ctx.supabase, ctx.accountId, 'pipelines', count ?? 0);

    const userId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    const { data: pipeline, error } = await ctx.supabase
      .from('pipelines')
      .insert({ account_id: ctx.accountId, user_id: userId, name, kind })
      .select(PIPELINE_SELECT)
      .single();
    if (error || !pipeline) return fail('internal', 'Failed to create pipeline', 500);

    const { data: inserted, error: stageErr } = await ctx.supabase
      .from('pipeline_stages')
      .insert(
        stages.map((s, i) => ({
          pipeline_id: pipeline.id,
          name: s.name,
          color: s.color,
          outcome: s.outcome,
          position: i,
        })),
      )
      .select('id, name, color, position, outcome')
      .order('position', { ascending: true });
    if (stageErr) {
      await ctx.supabase.from('pipelines').delete().eq('id', pipeline.id);
      return fail('internal', 'Failed to create pipeline stages', 500);
    }
    return ok({ ...pipeline, stages: inserted ?? [] }, 201);
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return fail('plan_limit', err.message, 402);
    }
    return toApiErrorResponse(err);
  }
}
