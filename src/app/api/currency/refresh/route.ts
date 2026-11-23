// POST /api/currency/refresh - called by the Cloudflare cron (header
// `x-cron-secret`). Cheap and safe to call every few minutes: it only hits the
// free rates API when the cached rates are over a day old (and retries a failed
// fetch no sooner than an hour later), falling back to the cached rates.

import { NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/crm/secret'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { refreshRates } from '@/lib/currency/rates'

async function run(request: Request) {
  const auth = cronAuthorized(request)
  if (auth === 'unconfigured') return NextResponse.json({ error: 'AUTOMATION_CRON_SECRET is not set' }, { status: 503 })
  if (auth === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ result: await refreshRates(supabaseAdmin()) })
}

export const POST = run
export const GET = run
