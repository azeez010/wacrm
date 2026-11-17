// GET /api/v1/team - account members (id, name, role). Automations'
// assign_conversation step and flows' handoff node need a user id.
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { requireAnyScope } from '@/lib/api/v1/scope';

export async function GET(request: Request) {
  try {
    const ctx = await requireAnyScope(request, ['automations:read', 'flows:read', 'pipelines:read']);
    const { data, error } = await ctx.supabase
      .from('profiles')
      .select('user_id, full_name, account_role')
      .eq('account_id', ctx.accountId);
    if (error) return fail('internal', 'Failed to list team members', 500);
    return ok(
      (data ?? []).map((p) => ({ user_id: p.user_id, name: p.full_name, role: p.account_role }))
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
