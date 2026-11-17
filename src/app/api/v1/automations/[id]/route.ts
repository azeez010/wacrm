// /api/v1/automations/[id]
//   GET     automation + step tree + activation_issues   (automations:read)
//   PATCH   edit fields / replace steps / (de)activate   (automations:write)
//   DELETE  delete                                       (automations:write)
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { isUuid } from '@/lib/api/v1/pagination';
import { AUTOMATION_SELECT, activationIssues, structuralError } from '@/lib/api/v1/automations';
import { loadStepsTree, replaceSteps, type BuilderStepInput } from '@/lib/automations/steps-tree';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiKey(request, 'automations:read');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Automation not found', 404);
    const { data: automation } = await ctx.supabase
      .from('automations')
      .select(AUTOMATION_SELECT)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!automation) return fail('not_found', 'Automation not found', 404);
    const steps = await loadStepsTree(id);
    return ok({
      automation,
      steps,
      activation_issues: activationIssues(automation.trigger_type, automation.trigger_config, steps),
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiKey(request, 'automations:write');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Automation not found', 404);
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) return fail('bad_request', 'Request body must be valid JSON', 400);

    const { data: existing } = await ctx.supabase
      .from('automations')
      .select('id, is_active, trigger_type, trigger_config')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!existing) return fail('not_found', 'Automation not found', 404);

    const triggerType = (b.trigger_type ?? existing.trigger_type) as unknown;
    const triggerConfig = b.trigger_config ?? existing.trigger_config;
    const bad = structuralError(triggerType, triggerConfig, b.steps);
    if (bad) return fail('bad_request', bad, 400);

    const update: Record<string, unknown> = {};
    if (b.name !== undefined) {
      const name = typeof b.name === 'string' ? b.name.trim() : '';
      if (!name || name.length > 120) return fail('bad_request', "'name' must be 1–120 chars", 400);
      update.name = name;
    }
    if (b.description !== undefined) update.description = typeof b.description === 'string' ? b.description : null;
    if (b.trigger_type !== undefined) update.trigger_type = b.trigger_type;
    if (b.trigger_config !== undefined) update.trigger_config = b.trigger_config;
    if (b.is_active !== undefined) {
      if (typeof b.is_active !== 'boolean') return fail('bad_request', "'is_active' must be a boolean", 400);
      update.is_active = b.is_active;
    }

    const willBeActive = typeof update.is_active === 'boolean' ? update.is_active : existing.is_active;
    const mergedSteps = Array.isArray(b.steps) ? b.steps : await loadStepsTree(id);
    const issues = activationIssues(String(triggerType), triggerConfig, mergedSteps);
    if (willBeActive && issues.length > 0) {
      return Response.json(
        { error: { code: 'bad_request', message: "Can't save an active automation with these issues", issues } },
        { status: 400 }
      );
    }

    if (Object.keys(update).length > 0) {
      const { error } = await ctx.supabase
        .from('automations')
        .update(update)
        .eq('id', id)
        .eq('account_id', ctx.accountId);
      if (error) return fail('internal', 'Failed to update automation', 500);
    }
    if (Array.isArray(b.steps)) {
      const err = await replaceSteps(id, b.steps as BuilderStepInput[]);
      if (err) return fail('internal', `Failed to save steps: ${err}`, 500);
    }

    const { data: automation } = await ctx.supabase
      .from('automations')
      .select(AUTOMATION_SELECT)
      .eq('id', id)
      .maybeSingle();
    return ok({ automation, steps: await loadStepsTree(id), activation_issues: issues });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiKey(request, 'automations:write');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Automation not found', 404);
    const { data, error } = await ctx.supabase
      .from('automations')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id');
    if (error) return fail('internal', 'Failed to delete automation', 500);
    if (!data || data.length === 0) return fail('not_found', 'Automation not found', 404);
    return ok({ id, deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
