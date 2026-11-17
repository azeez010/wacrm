// /api/v1/flows/[id]
//   GET     flow + nodes + issues                       (flows:read)
//   PUT     replace name/trigger/entry/fallback + graph (flows:write)
//   DELETE  delete (cancels runs; irreversible)         (flows:write)
// Change status with POST /api/v1/flows/[id]/status.
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { isUuid } from '@/lib/api/v1/pagination';
import {
  FLOW_SELECT,
  flowIssues,
  flowStructuralError,
  hasErrors,
  type FlowNodeInput,
} from '@/lib/api/v1/flows';

type Ctx = { params: Promise<{ id: string }> };
type Client = Awaited<ReturnType<typeof requireApiKey>>['supabase'];

async function loadFlow(db: Client, accountId: string, id: string) {
  const { data: flow } = await db
    .from('flows')
    .select(FLOW_SELECT)
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!flow) return null;
  const { data: nodes } = await db
    .from('flow_nodes')
    .select('node_key, node_type, config, position_x, position_y')
    .eq('flow_id', id)
    .order('created_at', { ascending: true });
  return { flow, nodes: (nodes ?? []) as FlowNodeInput[] };
}

export async function GET(request: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiKey(request, 'flows:read');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Flow not found', 404);
    const loaded = await loadFlow(ctx.supabase, ctx.accountId, id);
    if (!loaded) return fail('not_found', 'Flow not found', 404);
    return ok({ ...loaded, issues: flowIssues(loaded.flow, loaded.nodes) });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PUT(request: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiKey(request, 'flows:write');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Flow not found', 404);
    const current = await loadFlow(ctx.supabase, ctx.accountId, id);
    if (!current) return fail('not_found', 'Flow not found', 404);

    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) return fail('bad_request', 'Request body must be valid JSON', 400);
    if (b.name !== undefined && (typeof b.name !== 'string' || !b.name.trim())) {
      return fail('bad_request', "'name' can't be empty", 400);
    }
    const bad = flowStructuralError(b);
    if (bad) return fail('bad_request', bad, 400);

    const merged = {
      name: b.name !== undefined ? String(b.name).trim() : (current.flow.name as string),
      trigger_type: String(b.trigger_type ?? current.flow.trigger_type),
      trigger_config: (b.trigger_config ?? current.flow.trigger_config ?? {}) as Record<string, unknown>,
      entry_node_id:
        b.entry_node_id !== undefined ? (b.entry_node_id as string | null) : (current.flow.entry_node_id as string | null),
    };
    const nodes = (b.nodes as FlowNodeInput[] | undefined) ?? current.nodes;
    const issues = flowIssues(merged, nodes);

    // A live flow must stay valid — drafts may be incomplete.
    if (current.flow.status === 'active' && hasErrors(issues)) {
      return Response.json(
        { error: { code: 'bad_request', message: "Can't save an active flow with these errors — fix them or set it to draft first", issues } },
        { status: 422 }
      );
    }

    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch.name = merged.name;
    if (b.description !== undefined) patch.description = b.description;
    if (b.trigger_type !== undefined) patch.trigger_type = b.trigger_type;
    if (b.trigger_config !== undefined) patch.trigger_config = b.trigger_config;
    if (b.entry_node_id !== undefined) patch.entry_node_id = b.entry_node_id;
    if (b.fallback_policy !== undefined) patch.fallback_policy = b.fallback_policy;

    if (b.nodes !== undefined) {
      const { error } = await ctx.supabase.rpc('replace_flow_graph', {
        p_flow_id: id,
        p_nodes: nodes.map((n) => ({
          node_key: n.node_key,
          node_type: n.node_type,
          config: n.config,
          position_x: n.position_x ?? 0,
          position_y: n.position_y ?? 0,
        })),
        p_flow: patch,
      });
      if (error) return fail('bad_request', `Could not save the flow graph: ${error.message}`, 400);
    } else if (Object.keys(patch).length > 0) {
      const { error } = await ctx.supabase
        .from('flows')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('account_id', ctx.accountId);
      if (error) return fail('internal', 'Failed to update flow', 500);
    }

    const after = await loadFlow(ctx.supabase, ctx.accountId, id);
    return ok({ ...after, issues });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiKey(request, 'flows:write');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Flow not found', 404);
    const { data, error } = await ctx.supabase
      .from('flows')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id');
    if (error) return fail('internal', 'Failed to delete flow', 500);
    if (!data || data.length === 0) return fail('not_found', 'Flow not found', 404);
    return ok({ id, deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
