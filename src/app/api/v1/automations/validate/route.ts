// POST /api/v1/automations/validate — dry-run a definition without saving.
// Body: { trigger_type, trigger_config?, steps? } → { valid, issues }
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { activationIssues, structuralError } from '@/lib/api/v1/automations';

export async function POST(request: Request) {
  try {
    await requireApiKey(request, 'automations:read');
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) return fail('bad_request', 'Request body must be valid JSON', 400);
    const bad = structuralError(b.trigger_type, b.trigger_config, b.steps);
    if (bad) return ok({ valid: false, issues: [{ path: 'definition', message: bad }] });
    const issues = activationIssues(String(b.trigger_type), b.trigger_config, b.steps);
    return ok({ valid: issues.length === 0, issues });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
