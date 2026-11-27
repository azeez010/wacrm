// POST /api/billing/sweep - cron (x-cron-secret). Expires stale checkouts, moves subscriptions whose paid
// period (+ grace days from the admin console) has ended to past_due (= free limits), puts finished free trials
// back on Free, and sends the "trial ending" / "trial ended" emails and notifications.
import { NextResponse } from 'next/server'

import { cronAuthorized } from '@/lib/crm/secret'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { runTrialNotices } from '@/lib/billing/trial-notices'

async function run(request: Request) {
  const auth = cronAuthorized(request)
  if (auth === 'unconfigured') return NextResponse.json({ error: 'AUTOMATION_CRON_SECRET is not set' }, { status: 503 })
  if (auth === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = supabaseAdmin()
  const { data, error } = await db.rpc('payment_sweep')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const result = (data ?? {}) as { endedTrials?: { accountId: string; planId: string }[] }
  // Reminder window = the admin's "renewal reminder days" (default 3).
  const { data: settings } = await db.rpc('payment_checkout_settings', { p_account: null })
  const reminderDays = Number((settings as { reminderDays?: number } | null)?.reminderDays ?? 3) || 3
  const trials = await runTrialNotices(db, result.endedTrials ?? [], reminderDays).catch((e) => {
    console.error('[sweep] trial notices failed:', e instanceof Error ? e.message : e)
    return null
  })
  return NextResponse.json({ result: data, trials })
}

export const POST = run
export const GET = run
