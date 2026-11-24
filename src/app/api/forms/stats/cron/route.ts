import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/flows/admin-client'

/**
 * Refresh the pre-computed stats shown on the forms list (forms.stats_cache,
 * migration 087). Run by the Cloudflare cron every 5 minutes; same secret as the
 * other cron endpoints. Safe to call at any time: it recomputes from the raw
 * submissions and events, so a missed run only means slightly older numbers.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) return NextResponse.json({ error: 'cron not configured' }, { status: 503 })

  const supplied = Buffer.from(request.headers.get('x-cron-secret') ?? '')
  const wanted = Buffer.from(expected)
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin().rpc('refresh_form_stats', {})
  if (error) {
    console.error('[forms-stats-cron] refresh failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ refreshed: data ?? 0 })
}
