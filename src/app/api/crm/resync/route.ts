import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { enqueue } from '@/lib/crm/outbox'
import { isCrmEnabled } from '@/lib/crm/registry'
import { cronAuthorized } from '@/lib/crm/secret'

export const maxDuration = 60

/**
 * Queue a CRM sync for every user (first-time backfill, or a nightly refresh of
 * usage attributes). The jobs are then drained by /api/crm/flush.
 * Header: `x-cron-secret: $AUTOMATION_CRON_SECRET`.
 */
export async function POST(request: Request) {
  const auth = cronAuthorized(request)
  if (auth === 'unconfigured') return NextResponse.json({ error: 'AUTOMATION_CRON_SECRET is not set' }, { status: 503 })
  if (auth === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await isCrmEnabled())) return NextResponse.json({ error: 'No CRM provider configured' }, { status: 409 })

  const db = supabaseAdmin()
  let queued = 0
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('profiles')
      .select('user_id')
      .order('created_at', { ascending: true })
      .range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const row of (data ?? []) as Array<{ user_id: string }>) {
      if (await enqueue(db, { kind: 'contact', userId: row.user_id, dedupeKey: `contact:${row.user_id}` })) queued++
    }
    if ((data?.length ?? 0) < 1000) break
  }
  return NextResponse.json({ queued })
}
