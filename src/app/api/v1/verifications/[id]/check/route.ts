// POST /api/v1/verifications/{id}/check - check the code the user typed.
// Scope `otp:verify`. Body: { "code": "482913" }.
//
// Always 200 for an existing verification: `status` is "approved" on a match;
// "pending" (with `attempts_remaining`) on a wrong guess; "failed" once the
// guesses run out; "expired" / "canceled" otherwise.

import { requireApiKey } from '@/lib/auth/api-context'
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import { checkVerification } from '@/lib/otp/verifications'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'otp:verify')
    const { id } = await params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const code = body && typeof body.code === 'string' ? body.code.trim() : ''
    if (!code || code.length > 32) {
      return fail('bad_request', "'code' is required", 400)
    }
    const result = await checkVerification(ctx.supabase, ctx.accountId, id, code)
    if (!result) return fail('not_found', 'Verification not found', 404)
    return ok(result)
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
