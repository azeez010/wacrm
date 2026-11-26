// POST /api/payments/webhook/:instanceId: payment provider callbacks. One URL per payment instance
// (shown in the admin console) so we know which instance's secret verifies the signature.
// 401 on a bad signature; 200 for everything verified (also events we ignore), so the provider
// does not retry forever. Settlement is idempotent, so retries and replays are harmless.
import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/flows/admin-client'
import { applyEvent, driverContext } from '@/lib/payments/checkout'
import { paymentDriver } from '@/lib/payments/registry'
import { PaymentError } from '@/lib/payments/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request, { params }: { params: Promise<{ instanceId: string }> }) {
  const { instanceId } = await params
  if (!UUID.test(instanceId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const raw = await request.text()
  const db = supabaseAdmin()
  try {
    const { kind, ctx } = await driverContext(db, instanceId)
    const driver = paymentDriver(kind)
    if (!driver?.parseWebhook) return NextResponse.json({ error: 'This payment type has no webhook' }, { status: 404 })
    const event = await driver.parseWebhook(ctx, raw, request.headers)
    const outcome = await applyEvent(db, instanceId, kind, event)
    return NextResponse.json({ ok: true, outcome: outcome.status })
  } catch (e) {
    if (e instanceof PaymentError && (e.status === 401 || e.status === 404)) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[payments] webhook failed:', e instanceof Error ? e.message : e)
    // 500 so the provider retries later (database hiccup); settlement is idempotent.
    return NextResponse.json({ error: 'Temporary failure' }, { status: 500 })
  }
}
