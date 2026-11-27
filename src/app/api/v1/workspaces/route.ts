// /api/v1/workspaces (workspaces:manage) - across workspaces, for the person who created the key.
//   GET  every workspace they belong to, their role, its plan, and which one this key works in
//   POST { name } create a workspace they own (the plan's workspaces limit applies). It does not switch their
//        active workspace in the app, and this key cannot act in it: create a key inside the new workspace.
import { requireApiKey } from '@/lib/auth/api-context'
import { crmSyncUser } from '@/lib/crm'
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond'
import { MAX_WORKSPACE_NAME, rpcFailure } from '@/lib/workspace/api'

type Row = { account_id: string; account_role: string; created_at: string; accounts: { name?: string } | { name?: string }[] | null }

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'workspaces:manage')
    if (!ctx.createdBy) return fail('forbidden', 'The person who created this key is no longer a member', 403)
    const { data, error } = await ctx.supabase
      .from('account_members')
      .select('account_id, account_role, created_at, accounts(name)')
      .eq('user_id', ctx.createdBy)
      .order('created_at', { ascending: true })
    if (error) throw error
    const rows = (data ?? []) as Row[]
    const ids = rows.map((r) => r.account_id)
    const { data: subs } = ids.length
      ? await ctx.supabase.from('account_subscriptions').select('account_id, plan_id, status').in('account_id', ids)
      : { data: [] }
    const plan = new Map(((subs ?? []) as { account_id: string; plan_id: string; status: string }[]).map((s) => [s.account_id, s]))
    return ok(
      rows.map((r) => {
        const s = plan.get(r.account_id)
        return {
          id: r.account_id,
          name: (Array.isArray(r.accounts) ? r.accounts[0]?.name : r.accounts?.name) ?? '',
          role: r.account_role,
          plan_id: !s || s.status === 'canceled' || s.status === 'past_due' ? 'free' : s.plan_id,
          plan_status: s?.status ?? 'active',
          this_key: r.account_id === ctx.accountId,
        }
      }),
    )
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'workspaces:manage')
    if (!ctx.createdBy) return fail('forbidden', 'The person who created this key is no longer a member', 403)
    const body = (await request.json().catch(() => null)) as { name?: unknown } | null
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > MAX_WORKSPACE_NAME) return fail('bad_request', `name must be 1-${MAX_WORKSPACE_NAME} characters`, 400)
    const { data, error } = await ctx.supabase.rpc('api_create_workspace', { p_user: ctx.createdBy, p_name: name })
    if (error) {
      const r = rpcFailure(error)
      if (r) return r
      throw error
    }
    await crmSyncUser(ctx.createdBy).catch(() => undefined)
    return ok(
      {
        id: data as string,
        name,
        role: 'owner',
        note: 'Created. This key keeps working in its own workspace; create an API key inside the new workspace (Settings > API & MCP) to act there.',
      },
      201,
    )
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
