// /api/v1/team/{user_id} (workspace:manage)
//   PATCH  { role: 'admin' | 'agent' | 'viewer' } - change a member's role
//   DELETE - remove a member from this workspace (they keep or get a workspace of their own)
// Never the owner and never the key's creator; ownership is only transferred in the app.
import { requireApiKey } from '@/lib/auth/api-context'
import { isAccountRole } from '@/lib/auth/roles'
import { crmSyncUser } from '@/lib/crm'
import { onWorkspaceChanged } from '@/lib/onboarding/hooks'
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond'
import { rpcFailure } from '@/lib/workspace/api'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'workspace:manage')
    const { id } = await params
    if (!UUID.test(id)) return fail('not_found', 'Member not found', 404)
    const body = (await request.json().catch(() => null)) as { role?: unknown } | null
    const role = body?.role
    if (!isAccountRole(role) || role === 'owner') return fail('bad_request', "role must be 'admin', 'agent' or 'viewer'", 400)
    const { error } = await ctx.supabase.rpc('api_set_member_role', { p_account: ctx.accountId, p_actor: ctx.createdBy, p_user: id, p_role: role })
    if (error) {
      const r = rpcFailure(error)
      if (r) return r
      throw error
    }
    await onWorkspaceChanged(ctx.accountId)
    return ok({ user_id: id, role })
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'workspace:manage')
    const { id } = await params
    if (!UUID.test(id)) return fail('not_found', 'Member not found', 404)
    const { error } = await ctx.supabase.rpc('api_remove_member', { p_account: ctx.accountId, p_actor: ctx.createdBy, p_user: id })
    if (error) {
      const r = rpcFailure(error)
      if (r) return r
      throw error
    }
    await onWorkspaceChanged(ctx.accountId)
    await crmSyncUser(id).catch(() => undefined)
    return ok({ user_id: id, removed: true })
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
