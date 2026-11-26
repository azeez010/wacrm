import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { contentToQa, parseQaPairs, qaToContent } from '@/lib/ai/ingest/qa'
import { normalizeHttpUrl } from '@/lib/ai/ingest/fetch'
import { parsePathPrefixes } from '@/lib/ai/ingest/crawl-rules'
import { KNOWLEDGE_LIMITS, SYNC_INTERVALS, nextSyncAt, type SyncInterval } from '@/lib/ai/ingest/limits'
import { runKnowledgeQueue } from '@/lib/ai/ingest/pipeline'
import {
  IN_REQUEST_BUDGET_MS,
  SOURCE_LIST_COLUMNS,
  canEditSource,
} from '@/lib/ai/ingest/route-helpers'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

type Params = { params: Promise<{ id: string }> }

const KNOWLEDGE_BUCKET = 'knowledge-files'

/**
 * GET /api/ai/knowledge/sources/[id]  (any member)
 *
 * One source with its documents (pages / files). `?document=<id>` returns
 * that document's extracted text instead, for the preview.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await getCurrentAccount()
    const { supabase, accountId } = ctx
    const { id } = await params
    const documentId = new URL(request.url).searchParams.get('document')

    const { data: source, error } = await supabase
      .from('ai_knowledge_sources')
      .select(SOURCE_LIST_COLUMNS)
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) {
      console.error('[ai/knowledge/sources/:id GET] error:', error)
      return NextResponse.json({ error: t('ai.library.loadFailed') }, { status: 500 })
    }
    if (!source) return NextResponse.json({ error: t('ai.library.notFound') }, { status: 404 })

    if (documentId) {
      const { data: doc } = await supabase
        .from('ai_knowledge_documents')
        .select('id, title, url, content, status, error')
        .eq('id', documentId)
        .eq('source_id', id)
        .maybeSingle()
      if (!doc) return NextResponse.json({ error: t('ai.library.notFound') }, { status: 404 })
      return NextResponse.json({ document: doc })
    }

    const { data: docs } = await supabase
      .from('ai_knowledge_documents')
      .select('id, title, url, status, error, chunk_count, updated_at')
      .eq('source_id', id)
      .order('created_at', { ascending: true })
      .limit(KNOWLEDGE_LIMITS.maxWebsitePages + 50)

    // Text and Q&A sources are edited in place, so return their body.
    let editable: { content?: string; pairs?: { question: string; answer: string }[] } = {}
    if (source.type === 'text' || source.type === 'qa') {
      const { data: doc } = await supabase
        .from('ai_knowledge_documents')
        .select('content')
        .eq('source_id', id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      const content = (doc?.content as string | undefined) ?? ''
      editable = source.type === 'qa' ? { pairs: contentToQa(content) } : { content }
    }

    const { data: links } = await supabase
      .from('ai_agent_knowledge')
      .select('agent_id')
      .eq('source_id', id)

    return NextResponse.json({
      source: {
        ...source,
        ...editable,
        agent_ids: ((links ?? []) as { agent_id: string }[]).map((l) => l.agent_id),
        can_edit: canEditSource(ctx, source.created_by as string | null),
      },
      documents: docs ?? [],
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/ai/knowledge/sources/[id]  (admins, or the agent who added it)
 *
 * Rename, change re-sync, or edit the content: text, Q&A pairs, the page
 * URL, or the website's crawl settings. Content changes are re-indexed.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('agent')
    const { supabase, accountId, userId } = ctx
    const limit = checkRateLimit(`ai-library:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: t('common.invalidRequestBody') }, { status: 400 })

    const { data: source } = await supabase
      .from('ai_knowledge_sources')
      .select('id, type, config, created_by, sync_interval')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!source) return NextResponse.json({ error: t('ai.library.notFound') }, { status: 404 })
    if (!canEditSource(ctx, source.created_by)) {
      return NextResponse.json({ error: t('ai.library.notAllowed') }, { status: 403 })
    }

    const update: Record<string, unknown> = {}
    let reindex = false
    let newContent: string | null = null
    let newUrl: string | null = null

    if ('name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : ''
      if (!name) return NextResponse.json({ error: t('ai.library.nameRequired') }, { status: 400 })
      update.name = name
    }
    if ('sync_interval' in body && (source.type === 'url' || source.type === 'website')) {
      const interval = body.sync_interval as SyncInterval
      if (!SYNC_INTERVALS.includes(interval)) {
        return NextResponse.json({ error: t('common.invalidRequestBody') }, { status: 400 })
      }
      update.sync_interval = interval
      update.next_sync_at = nextSyncAt(interval)
    }
    if ('content' in body && (source.type === 'text' || source.type === 'file')) {
      const content = typeof body.content === 'string' ? body.content.trim() : ''
      if (!content) return NextResponse.json({ error: t('ai.library.contentRequired') }, { status: 400 })
      if (content.length > KNOWLEDGE_LIMITS.maxDocChars) {
        return NextResponse.json({ error: t('ai.library.contentTooLong') }, { status: 400 })
      }
      newContent = content
    }
    if ('pairs' in body && source.type === 'qa') {
      const pairs = parseQaPairs(body.pairs)
      if (pairs.length === 0) return NextResponse.json({ error: t('ai.library.pairsRequired') }, { status: 400 })
      newContent = qaToContent(pairs)
    }
    if ('url' in body && source.type === 'url') {
      newUrl = normalizeHttpUrl(typeof body.url === 'string' ? body.url : '')
      if (!newUrl) return NextResponse.json({ error: t('ai.library.urlInvalid') }, { status: 400 })
      update.config = { url: newUrl }
    }
    if (source.type === 'website' && ['start_url', 'max_pages', 'include', 'exclude'].some((k) => k in body)) {
      const cfg = { ...((source.config as Record<string, unknown>) ?? {}) }
      if ('start_url' in body) {
        const startUrl = normalizeHttpUrl(typeof body.start_url === 'string' ? body.start_url : '')
        if (!startUrl) return NextResponse.json({ error: t('ai.library.urlInvalid') }, { status: 400 })
        cfg.startUrl = startUrl
      }
      if ('max_pages' in body) {
        const n = Number(body.max_pages)
        cfg.maxPages = Number.isFinite(n)
          ? Math.min(KNOWLEDGE_LIMITS.maxWebsitePages, Math.max(1, Math.floor(n)))
          : KNOWLEDGE_LIMITS.defaultWebsitePages
      }
      if ('include' in body) cfg.include = parsePathPrefixes(body.include)
      if ('exclude' in body) cfg.exclude = parsePathPrefixes(body.exclude)
      update.config = cfg
      update.status = 'queued' // rediscover pages
      reindex = true
    }

    if (newContent !== null || newUrl !== null) {
      const docUpdate: Record<string, unknown> = { status: 'queued', error: null }
      if (newContent !== null) docUpdate.content = newContent
      if (newUrl !== null) docUpdate.url = newUrl
      if ('name' in update && (source.type === 'text' || source.type === 'qa')) docUpdate.title = update.name
      const { error: docErr } = await supabase
        .from('ai_knowledge_documents')
        .update(docUpdate)
        .eq('source_id', id)
      if (docErr) {
        console.error('[ai/knowledge/sources/:id PATCH] document update error:', docErr)
        return NextResponse.json({ error: t('ai.library.saveFailed') }, { status: 500 })
      }
      update.status = 'processing'
      reindex = true
    } else if ('name' in update && (source.type === 'text' || source.type === 'qa')) {
      await supabase.from('ai_knowledge_documents').update({ title: update.name }).eq('source_id', id)
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase.from('ai_knowledge_sources').update(update).eq('id', id)
      if (error) {
        console.error('[ai/knowledge/sources/:id PATCH] error:', error)
        return NextResponse.json({ error: t('ai.library.saveFailed') }, { status: 500 })
      }
    }
    if (reindex) {
      await runKnowledgeQueue(supabaseAdmin(), {
        deadline: Date.now() + IN_REQUEST_BUDGET_MS,
        onlySourceId: id,
      })
    }

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

/**
 * DELETE /api/ai/knowledge/sources/[id]  (admins, or the agent who added it)
 *
 * Removes the source everywhere: its documents, chunks, agent links and
 * any uploaded file.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('agent')
    const { supabase, accountId } = ctx
    const { id } = await params
    const { data: source } = await supabase
      .from('ai_knowledge_sources')
      .select('id, type, config, created_by')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!source) return NextResponse.json({ error: t('ai.library.notFound') }, { status: 404 })
    if (!canEditSource(ctx, source.created_by)) {
      return NextResponse.json({ error: t('ai.library.notAllowed') }, { status: 403 })
    }

    const { error } = await supabase.from('ai_knowledge_sources').delete().eq('id', id)
    if (error) {
      console.error('[ai/knowledge/sources/:id DELETE] error:', error)
      return NextResponse.json({ error: t('ai.library.deleteFailed') }, { status: 500 })
    }

    const storagePath = (source.config as { storagePath?: unknown } | null)?.storagePath
    if (source.type === 'file' && typeof storagePath === 'string' && storagePath.startsWith(`account-${accountId}/`)) {
      const { error: rmErr } = await supabaseAdmin().storage.from(KNOWLEDGE_BUCKET).remove([storagePath])
      if (rmErr) console.error('[ai/knowledge/sources/:id DELETE] file removal failed:', rmErr)
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
