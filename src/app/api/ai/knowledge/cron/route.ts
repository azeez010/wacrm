import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { runKnowledgeQueue } from '@/lib/ai/ingest/pipeline'

/** Leaves headroom under the cron runner's 50 s job timeout. */
const RUN_BUDGET_MS = 40_000

/**
 * POST /api/ai/knowledge/cron
 *
 * The knowledge library's background worker, run by the Cloudflare cron
 * every 5 minutes with the shared cron secret: scheduled re-syncs, website
 * page discovery, and indexing of queued pages and documents.
 */
export async function POST(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) return NextResponse.json({ error: 'cron not configured' }, { status: 503 })

  const supplied = Buffer.from(request.headers.get('x-cron-secret') ?? '')
  const wanted = Buffer.from(expected)
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const stats = await runKnowledgeQueue(supabaseAdmin(), { deadline: Date.now() + RUN_BUDGET_MS })
    return NextResponse.json(stats)
  } catch (err) {
    console.error('[knowledge cron] run failed:', err)
    return NextResponse.json({ error: 'run failed' }, { status: 500 })
  }
}
