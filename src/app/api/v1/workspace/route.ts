// /api/v1/workspace - the workspace this key belongs to.
//   GET   (workspace:read)   name, timezone, currency, plan, owner and team size by role
//   PATCH (workspace:manage) rename it or change its timezone
import { requireApiKey } from '@/lib/auth/api-context'
import { getEntitlements } from '@/lib/billing/entitlements'
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond'
import { MAX_WORKSPACE_NAME, isTimeZone } from '@/lib/workspace/api'

async function load(ctx: Awaited<ReturnType<typeof requireApiKey>>) {
  const [acct, members, ents, sub] = await Promise.all([
    ctx.supabase.from('accounts').select('id, name, timezone, default_currency, owner_user_id, created_at').eq('id', ctx.accountId).single(),
    ctx.supabase.from('workspace_members').select('user_id, full_name, account_role').eq('account_id', ctx.accountId),
    getEntitlements(ctx.supabase, ctx.accountId),
    ctx.supabase.from('account_subscriptions').select('plan_id, status, current_period_end').eq('account_id', ctx.accountId).maybeSingle(),
  ])
  if (acct.error || !acct.data) throw acct.error ?? new Error('workspace not found')
  const rows = (members.data ?? []) as { user_id: string; full_name: string | null; account_role: string }[]
  const byRole: Record<string, number> = {}
  for (const m of rows) byRole[m.account_role] = (byRole[m.account_role] ?? 0) + 1
  const owner = rows.find((m) => m.user_id === acct.data.owner_user_id)
  const s = sub.data as { plan_id?: string; status?: string; current_period_end?: string | null } | null
  return {
    id: acct.data.id,
    name: acct.data.name,
    timezone: acct.data.timezone ?? null,
    currency: acct.data.default_currency ?? null,
    created_at: acct.data.created_at,
    owner: { user_id: acct.data.owner_user_id, name: owner?.full_name ?? null },
    plan: { name: ents.planName, status: s?.status ?? 'active', current_period_end: s?.current_period_end ?? null },
    members: { total: rows.length, by_role: byRole },
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'workspace:read')
    return ok(await load(ctx))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'workspace:manage')
    const body = (await request.json().catch(() => null)) as { name?: unknown; timezone?: unknown } | null
    if (!body || typeof body !== 'object') return fail('bad_request', 'Body must be a JSON object', 400)
    const update: Record<string, string> = {}
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name || name.length > MAX_WORKSPACE_NAME) return fail('bad_request', `name must be 1-${MAX_WORKSPACE_NAME} characters`, 400)
      update.name = name
    }
    if (body.timezone !== undefined) {
      if (typeof body.timezone !== 'string' || !isTimeZone(body.timezone)) return fail('bad_request', 'timezone must be an IANA time zone, e.g. Africa/Lagos', 400)
      update.timezone = body.timezone
    }
    if (Object.keys(update).length === 0) return fail('bad_request', 'Nothing to update: send name and/or timezone', 400)
    const { error } = await ctx.supabase.from('accounts').update(update).eq('id', ctx.accountId)
    if (error) throw error
    return ok(await load(ctx))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
