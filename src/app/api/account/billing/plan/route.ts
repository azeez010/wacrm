// POST /api/account/billing/plan  { plan_id }
//
// Switch the account's plan right away, with no payment (payments are not connected yet).
// Admin+. Set BILLING_MANUAL_SWITCH=off to turn this off once real billing exists.
import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { changePlan } from '@/lib/billing/change-plan'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    if (process.env.BILLING_MANUAL_SWITCH === 'off') {
      return NextResponse.json({ error: 'Plan changes are handled by billing' }, { status: 403 })
    }
    const limit = checkRateLimit(`admin:planSwitch:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as { plan_id?: unknown } | null
    const planId = typeof body?.plan_id === 'string' ? body.plan_id.trim() : ''
    if (!planId) return NextResponse.json({ error: "'plan_id' is required" }, { status: 400 })

    const result = await changePlan(supabaseAdmin(), ctx.accountId, planId)
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error === 'unknown_plan' ? 'That plan does not exist' : 'Could not change the plan' },
        { status: result.error === 'unknown_plan' ? 400 : 500 },
      )
    }
    return NextResponse.json({ plan_id: result.planId, plan_name: result.planName })
  } catch (err) {
    return toErrorResponse(err)
  }
}
