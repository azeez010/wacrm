// POST /api/onboarding/test-otp - the checklist's "send yourself a code" step.
//
//   { "to": "+2348012345678" }          → send a verification code
//   { "id": "<uuid>", "code": "123456" } → check the code that arrived
//
// Session-authenticated (admin+), limited to a few sends an hour, and it uses the
// same code path (and plan quota) as the public API.

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { ApiError } from '@/lib/api/v1/respond'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { SendMessageError } from '@/lib/whatsapp/send-message'
import { checkVerification, createVerification } from '@/lib/otp/verifications'
import { QuotaExceededError } from '@/lib/billing/usage'

const SENDS_PER_HOUR = { limit: 3, windowMs: 60 * 60 * 1000 }

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const db = supabaseAdmin()

    if (body && typeof body.id === 'string' && typeof body.code === 'string') {
      const result = await checkVerification(db, ctx.accountId, body.id, body.code.trim())
      if (!result) return NextResponse.json({ error: 'Verification not found' }, { status: 404 })
      return NextResponse.json(result)
    }

    if (!body || typeof body.to !== 'string') return NextResponse.json({ error: "'to' is required" }, { status: 400 })
    const rl = checkRateLimit(`onboarding:testOtp:${ctx.userId}`, SENDS_PER_HOUR)
    if (!rl.success) return rateLimitResponse(rl)

    const { verification } = await createVerification(db, ctx.accountId, { to: body.to })
    return NextResponse.json({ id: verification.id, status: verification.status, expires_at: verification.expires_at })
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status, headers: err.headers })
    if (err instanceof SendMessageError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    if (err instanceof QuotaExceededError) return NextResponse.json({ error: err.message, code: 'quota_exceeded' }, { status: 402 })
    return toErrorResponse(err)
  }
}
