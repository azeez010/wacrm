import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { flushOutbox, type FlushResult } from '@/lib/crm/outbox'
import { cronAuthorized } from '@/lib/crm/secret'

export const maxDuration = 60

/**
 * Drain the CRM outbox. Hit it every few minutes from an external scheduler
 * (it is how retries after a provider outage get delivered); every enqueue also
 * drains opportunistically. Header: `x-cron-secret: $CRM_CRON_SECRET`.
 */
async function run(request: Request) {
  const auth = cronAuthorized(request)
  if (auth === 'unconfigured') return NextResponse.json({ error: 'CRM_CRON_SECRET is not set' }, { status: 503 })
  if (auth === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const total: FlushResult = { claimed: 0, sent: 0, retried: 0, dead: 0 }
  for (let i = 0; i < 5; i++) {
    const r = await flushOutbox(supabaseAdmin(), 20)
    total.claimed += r.claimed
    total.sent += r.sent
    total.retried += r.retried
    total.dead += r.dead
    if (r.claimed < 20) break
  }
  return NextResponse.json(total)
}

export const GET = run
export const POST = run
