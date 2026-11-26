// GET  /api/account/billing/checkout?plan_id=&interval=   which payment methods this customer can use, with prices
// POST /api/account/billing/checkout { plan_id, interval, method }   start a checkout (failover across payment instances)
// Admin+. When the platform has payments off for this account (admin console), GET says mode 'off'
// and POST answers 409 payments_off, so the client keeps using the free plan switch.
import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { PAYMENT_METHODS, type PaymentMethod } from '@/lib/payments/catalogue'
import { startCheckout } from '@/lib/payments/checkout'
import { customerPaymentContext, methodOptions } from '@/lib/payments/customer'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { SITE_URL } from '@/lib/seo'

const INTERVALS = ['monthly', 'quarterly', 'annual'] as const
type Interval = (typeof INTERVALS)[number]
const isInterval = (v: unknown): v is Interval => typeof v === 'string' && (INTERVALS as readonly string[]).includes(v)

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const url = new URL(request.url)
    const planId = url.searchParams.get('plan_id') ?? ''
    const interval = url.searchParams.get('interval') ?? 'monthly'
    if (!planId || !isInterval(interval)) return NextResponse.json({ error: "'plan_id' and a valid 'interval' are required" }, { status: 400 })
    const db = supabaseAdmin()
    const pc = await customerPaymentContext(db, ctx.accountId, ctx.userId)
    return NextResponse.json({ mode: pc.mode, country: pc.country, currency: pc.currency, methods: await methodOptions(db, pc, planId, interval) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`billing:checkout:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const body = (await request.json().catch(() => null)) as { plan_id?: unknown; interval?: unknown; method?: unknown } | null
    const planId = typeof body?.plan_id === 'string' ? body.plan_id.trim() : ''
    const method = body?.method as PaymentMethod
    if (!planId || !isInterval(body?.interval) || !PAYMENT_METHODS.includes(method)) {
      return NextResponse.json({ error: "'plan_id', 'interval' and 'method' are required" }, { status: 400 })
    }
    const db = supabaseAdmin()
    const pc = await customerPaymentContext(db, ctx.accountId, ctx.userId)
    if (pc.mode === 'off') return NextResponse.json({ error: 'payments_off' }, { status: 409 })
    const { data: profile } = await db.from('profiles').select('email').eq('user_id', ctx.userId).maybeSingle()
    const email = typeof profile?.email === 'string' ? profile.email : ''
    if (!email) return NextResponse.json({ error: 'Your profile has no email address' }, { status: 400 })

    const r = await startCheckout(db, {
      accountId: ctx.accountId, userId: ctx.userId, email, planId, interval: body!.interval as Interval, method,
      country: pc.country, currency: pc.currency, mode: pc.mode, appUrl: SITE_URL, transferExpiryDays: pc.transferExpiryDays,
    })
    if (!r.ok) {
      const status = r.error === 'unknown_plan' ? 400 : r.error === 'no_provider' ? 409 : 502
      return NextResponse.json({ error: r.error, reference: r.reference ?? null }, { status })
    }
    return NextResponse.json({
      reference: r.reference, amount: r.amount, currency: r.currency,
      ...(r.result.kind === 'redirect' ? { redirectUrl: r.result.url } : { instructions: r.result.instructions }),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
