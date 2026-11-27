// GET /api/v1/plan - the workspace's plan, every limit with what is used (and near/at-limit flags), the
// features it includes, what a lower plan archived, and where to upgrade. Needs a valid key, no scope.
import { requireApiKey } from '@/lib/auth/api-context'
import { planSummary } from '@/lib/billing/plan-summary'
import { ok, toApiErrorResponse } from '@/lib/api/v1/respond'

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request)
    return ok(await planSummary(ctx.supabase, ctx.accountId, ctx.createdBy))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
