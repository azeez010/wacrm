// POST /api/account/billing/cancel - stop the plan renewing (admin+). The paid period runs out normally, then the
// account moves to Free. Card subscriptions are disabled at the payment provider first.
import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { crmTrack } from '@/lib/crm'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { cancelRenewal } from '@/lib/payments/checkout'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST() {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`billing:cancel:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const out = await cancelRenewal(supabaseAdmin(), ctx.accountId)
    if (out.status === 'failed') {
      console.error('[billing/cancel] provider cancel failed:', out.error)
      return NextResponse.json({ error: 'provider_failed', message: 'We could not stop the renewal at the payment provider. Please try again.' }, { status: 502 })
    }
    if (out.status === 'stopped') {
      await crmTrack('subscription_cancel_requested', { accountId: ctx.accountId, userId: ctx.userId, onceKey: `cancel:${ctx.accountId}:${out.periodEnd ?? ''}` }).catch(() => undefined)
    }
    return NextResponse.json({ ok: true, status: out.status, periodEnd: out.periodEnd ?? null })
  } catch (err) {
    return toErrorResponse(err)
  }
}
