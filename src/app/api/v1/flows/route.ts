// /api/v1/flows — chatbot flows (button/list menus, input capture, branching).
//   GET   list                                  (flows:read)
//   POST  create a DRAFT flow with its graph    (flows:write)
// Node types and configs: see the MCP `get_flow_reference` tool.
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseListParams, keysetFilter, buildPage } from '@/lib/api/v1/pagination';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import { FLOW_SELECT, flowIssues, flowStructuralError, type FlowNodeInput } from '@/lib/api/v1/flows';
import { assertFeature, assertWithinLimit, FeatureLockedError, PlanLimitError } from '@/lib/billing/entitlements';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'flows:read');
    const { limit, cursor } = parseListParams(request);
    let query = ctx.supabase
      .from('flows')
      .select(FLOW_SELECT)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);
    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);
    const { data, error } = await query;
    if (error) return fail('internal', 'Failed to list flows', 500);
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
    const ctx = await requireApiKey(request, 'flows:write');
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) return fail('bad_request', 'Request body must be valid JSON', 400);

    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 120) return fail('bad_request', "'name' is required (max 120 chars)", 400);
    if (b.trigger_type === undefined) return fail('bad_request', "'trigger_type' is required", 400);
    const bad = flowStructuralError(b);
    if (bad) return fail('bad_request', bad, 400);

    await assertFeature(ctx.supabase, ctx.accountId, 'flows');
    const { count } = await ctx.supabase
      .from('flows')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId);
    await assertWithinLimit(ctx.supabase, ctx.accountId, 'flows', count ?? 0);

    const userId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    const triggerConfig = (b.trigger_config as Record<string, unknown> | undefined) ?? {};
    const entry = typeof b.entry_node_id === 'string' ? b.entry_node_id : null;
    const nodes = (b.nodes as FlowNodeInput[] | undefined) ?? [];

    const insert: Record<string, unknown> = {
      account_id: ctx.accountId,
      user_id: userId,
      name,
      description: typeof b.description === 'string' ? b.description : null,
      status: 'draft',
      trigger_type: b.trigger_type,
      trigger_config: triggerConfig,
      entry_node_id: entry,
    };
    if (b.fallback_policy !== undefined) insert.fallback_policy = b.fallback_policy;

    const { data: flow, error } = await ctx.supabase.from('flows').insert(insert).select(FLOW_SELECT).single();
    if (error || !flow) return fail('internal', 'Failed to create flow', 500);

    if (nodes.length > 0) {
      const { error: graphErr } = await ctx.supabase.rpc('replace_flow_graph', {
        p_flow_id: flow.id,
        p_nodes: nodes.map((n) => ({
          node_key: n.node_key,
          node_type: n.node_type,
          config: n.config,
          position_x: n.position_x ?? 0,
          position_y: n.position_y ?? 0,
        })),
        p_flow: {},
      });
      if (graphErr) {
        await ctx.supabase.from('flows').delete().eq('id', flow.id);
        return fail('bad_request', `Could not save the flow graph: ${graphErr.message}`, 400);
      }
    }

    return ok(
      {
        flow,
        nodes,
        issues: flowIssues({ name, trigger_type: String(b.trigger_type), trigger_config: triggerConfig, entry_node_id: entry }, nodes),
      },
      201
    );
  } catch (err) {
    if (err instanceof PlanLimitError || err instanceof FeatureLockedError) {
      return fail('plan_limit', err.message, 402);
    }
    return toApiErrorResponse(err);
  }
}
