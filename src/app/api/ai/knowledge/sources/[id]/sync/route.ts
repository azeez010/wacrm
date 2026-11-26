import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import {
  SOURCE_COLUMNS,
  queueSourceSync,
  runKnowledgeQueue,
  type SourceRow,
} from '@/lib/ai/ingest/pipeline'
import {
  IN_REQUEST_BUDGET_MS,
  SOURCE_LIST_COLUMNS,
  canEditSource,
} from '@/lib/ai/ingest/route-helpers'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/ai/knowledge/sources/[id]/sync  (admins, or the agent who added it)
 *
 * Re-sync now: web pages and websites are fetched again (unchanged pages
 * are skipped by their content hash); text, Q&A and files are re-embedded,
 * e.g. after adding an embeddings key.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('agent')
    const { supabase, accountId, userId } = ctx
    const limit = checkRateLimit(`ai-library-sync:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params

    const { data: row } = await supabase
      .from('ai_knowledge_sources')
      .select(`${SOURCE_COLUMNS}, created_by`)
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!row) return NextResponse.json({ error: t('ai.library.notFound') }, { status: 404 })
    if (!canEditSource(ctx, (row as { created_by: string | null }).created_by)) {
      return NextResponse.json({ error: t('ai.library.notAllowed') }, { status: 403 })
    }
    const source = row as unknown as SourceRow
    const admin = supabaseAdmin()

    if (source.type === 'url' || source.type === 'website') {
      await queueSourceSync(admin, source)
    } else {
      // Clear the hash so unchanged text is still re-embedded.
      await admin
        .from('ai_knowledge_documents')
        .update({ status: 'queued', error: null, content_hash: null })
        .eq('source_id', id)
      await admin.from('ai_knowledge_sources').update({ status: 'processing', error: null }).eq('id', id)
    }
    await runKnowledgeQueue(admin, { deadline: Date.now() + IN_REQUEST_BUDGET_MS, onlySourceId: id })

    const { data: fresh } = await supabase
      .from('ai_knowledge_sources')
      .select(SOURCE_LIST_COLUMNS)
      .eq('id', id)
      .single()
    return NextResponse.json({ source: fresh })
  } catch (err) {
    return toErrorResponse(err)
  }
}
