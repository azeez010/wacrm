// /api/v1/invitations - pending invitations to this workspace.
//   GET  (workspace:read)   invitations not yet used and not expired
//   POST (workspace:manage) create a one-time invite link { role, label?, expires_in_days? }; the url is returned
//                           only here. Members plus pending invitations count toward the plan's seat limit.
import { requireApiKey } from '@/lib/auth/api-context'
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond'
import { createInvitation, listInvitations } from '@/lib/workspace/api'

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'workspace:read')
    return ok(await listInvitations(ctx.supabase, ctx.accountId))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'workspace:manage')
    if (!ctx.createdBy) return fail('forbidden', 'The person who created this key is no longer a member', 403)
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return fail('bad_request', 'Body must be a JSON object', 400)
    const out = await createInvitation(ctx.supabase, ctx.accountId, ctx.createdBy, body)
    if (!out.ok) return fail('bad_request', out.message, 400)
    return ok(out.value, 201)
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
