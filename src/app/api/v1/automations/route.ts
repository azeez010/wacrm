// /api/v1/automations
//   GET   list automations                        (automations:read)
//   POST  create one — as a DRAFT unless is_active (automations:write)
//
// Trigger types, step types and every config shape are documented by the
// MCP `get_automation_reference` tool. A draft may be incomplete; the
// response lists `activation_issues` so a builder can iterate until empty.
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseListParams, keysetFilter, buildPage } from '@/lib/api/v1/pagination';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import { AUTOMATION_SELECT, activationIssues, structuralError } from '@/lib/api/v1/automations';
import { insertSteps, loadStepsTree, type BuilderStepInput } from '@/lib/automations/steps-tree';
import { assertFeature, assertWithinLimit, FeatureLockedError, PlanLimitError } from '@/lib/billing/entitlements';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'automations:read');
    const { limit, cursor } = parseListParams(request);
    let query = ctx.supabase
      .from('automations')
      .select(AUTOMATION_SELECT)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);
    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);
    const { data, error } = await query;
    if (error) return fail('internal', 'Failed to list automations', 500);
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
    const ctx = await requireApiKey(request, 'automations:write');
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) return fail('bad_request', 'Request body must be valid JSON', 400);

    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 120) return fail('bad_request', "'name' is required (max 120 chars)", 400);
    const bad = structuralError(b.trigger_type, b.trigger_config, b.steps);
    if (bad) return fail('bad_request', bad, 400);

    const triggerType = b.trigger_type as string;
    const triggerConfig = (b.trigger_config as Record<string, unknown> | undefined) ?? {};
    const steps = (b.steps as BuilderStepInput[] | undefined) ?? [];
    const wantActive = b.is_active === true;

    const issues = activationIssues(triggerType, triggerConfig, steps);
    if (wantActive && issues.length > 0) {
      return Response.json(
        { error: { code: 'bad_request', message: "Can't activate — fix these issues first", issues } },
        { status: 400 }
      );
    }

    await assertFeature(ctx.supabase, ctx.accountId, 'automations');
    const { count } = await ctx.supabase
      .from('automations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
      // The seeded default (system_key) never uses up the plan's quota.
      .is('system_key', null);
    await assertWithinLimit(ctx.supabase, ctx.accountId, 'automations', count ?? 0);

    const userId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    const { data: automation, error } = await ctx.supabase
      .from('automations')
      .insert({
        account_id: ctx.accountId,
        user_id: userId,
        name,
        description: typeof b.description === 'string' ? b.description : null,
        trigger_type: triggerType,
        trigger_config: triggerConfig,
        is_active: wantActive,
      })
      .select(AUTOMATION_SELECT)
      .single();
    if (error || !automation) return fail('internal', 'Failed to create automation', 500);

    const stepErr = await insertSteps(automation.id, steps);
    if (stepErr) {
      await ctx.supabase.from('automations').delete().eq('id', automation.id);
      return fail('internal', `Failed to save steps: ${stepErr}`, 500);
    }
    return ok(
      { automation, steps: await loadStepsTree(automation.id), activation_issues: issues },
      201
    );
  } catch (err) {
    if (err instanceof PlanLimitError) return fail('plan_limit', err.message, 402);
    if (err instanceof FeatureLockedError) return fail('plan_limit', err.message, 402);
    return toApiErrorResponse(err);
  }
}
