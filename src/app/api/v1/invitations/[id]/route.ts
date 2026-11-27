// DELETE /api/v1/invitations/{id} (workspace:manage) - revoke a pending invitation; its link stops working.
import { requireApiKey } from '@/lib/auth/api-context'
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'workspace:manage')
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail('not_found', 'Invitation not found', 404)
    const { error, count } = await ctx.supabase
      .from('account_invitations')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .is('accepted_at', null)
    if (error) throw error
    if (!count) return fail('not_found', 'Invitation not found', 404)
    return ok({ id, revoked: true })
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
