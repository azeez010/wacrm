// POST /api/billing/sweep - cron (x-cron-secret). Expires stale checkouts and moves subscriptions
// whose paid period (+ grace days from the admin console) has ended to past_due (= free limits).
import { NextResponse } from 'next/server'

import { cronAuthorized } from '@/lib/crm/secret'
import { supabaseAdmin } from '@/lib/flows/admin-client'

async function run(request: Request) {
  const auth = cronAuthorized(request)
  if (auth === 'unconfigured') return NextResponse.json({ error: 'AUTOMATION_CRON_SECRET is not set' }, { status: 503 })
  if (auth === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data, error } = await supabaseAdmin().rpc('payment_sweep')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ result: data })
}

export const POST = run
export const GET = run
