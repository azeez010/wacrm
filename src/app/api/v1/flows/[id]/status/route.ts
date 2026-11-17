// POST /api/v1/flows/[id]/status  { status: 'draft' | 'active' | 'archived' }
// Activating runs the full validator and refuses on any error. Leaving
// 'active' cancels the flow's in-progress runs (same as the dashboard).
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { isUuid } from '@/lib/api/v1/pagination';
import { FLOW_SELECT, flowIssues, hasErrors, type FlowNodeInput } from '@/lib/api/v1/flows';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'flows:write');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Flow not found', 404);
    const b = (await request.json().catch(() => null)) as { status?: string } | null;
    const status = b?.status;
    if (!status || !['draft', 'active', 'archived'].includes(status)) {
      return fail('bad_request', "'status' must be draft, active or archived", 400);
    }

    const { data: flow } = await ctx.supabase
      .from('flows')
      .select('name, trigger_type, trigger_config, entry_node_id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!flow) return fail('not_found', 'Flow not found', 404);

    if (status === 'active') {
      const { data: nodes } = await ctx.supabase
        .from('flow_nodes')
        .select('node_key, node_type, config')
        .eq('flow_id', id);
      const issues = flowIssues(
        flow as Parameters<typeof flowIssues>[0],
        (nodes ?? []) as FlowNodeInput[]
      );
      if (hasErrors(issues)) {
        return Response.json(
          { error: { code: 'bad_request', message: "Can't activate — fix these errors first", issues } },
          { status: 422 }
        );
      }
    }

    const { data: updated, error } = await ctx.supabase
      .from('flows')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(FLOW_SELECT)
      .single();
    if (error) return fail('internal', 'Failed to change flow status', 500);

    if (status !== 'active') {
      await ctx.supabase
        .from('flow_runs')
        .update({ status: 'cancelled', ended_at: new Date().toISOString(), end_reason: `flow_${status}` })
        .eq('flow_id', id)
        .eq('status', 'active');
    }
    return ok(updated);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
