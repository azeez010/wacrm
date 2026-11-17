// POST /api/v1/flows/validate — dry-run a flow definition without saving.
// Body: { name?, trigger_type, trigger_config?, entry_node_id?, nodes } → { valid, issues }
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { flowIssues, flowStructuralError, hasErrors, type FlowNodeInput } from '@/lib/api/v1/flows';

export async function POST(request: Request) {
  try {
    await requireApiKey(request, 'flows:read');
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) return fail('bad_request', 'Request body must be valid JSON', 400);
    const bad = flowStructuralError(b);
    if (bad || b.trigger_type === undefined) {
      return ok({ valid: false, issues: [{ severity: 'error', scope: 'flow', message: bad ?? "'trigger_type' is required" }] });
    }
    const issues = flowIssues(
      {
        name: typeof b.name === 'string' ? b.name : 'Untitled',
        trigger_type: String(b.trigger_type),
        trigger_config: (b.trigger_config as Record<string, unknown>) ?? {},
        entry_node_id: typeof b.entry_node_id === 'string' ? b.entry_node_id : null,
      },
      ((b.nodes as FlowNodeInput[] | undefined) ?? [])
    );
    return ok({ valid: !hasErrors(issues), issues });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
