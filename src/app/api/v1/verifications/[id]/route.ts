// GET /api/v1/verifications/{id} - status of a verification, including whether
// the code was delivered (and WhatsApp's reason if it failed). Scope `otp:verify`.

import { requireApiKey } from '@/lib/auth/api-context'
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import { getVerification } from '@/lib/otp/verifications'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'otp:verify')
    const { id } = await params
    const verification = await getVerification(ctx.supabase, ctx.accountId, id)
    if (!verification) return fail('not_found', 'Verification not found', 404)
    return ok(verification)
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
