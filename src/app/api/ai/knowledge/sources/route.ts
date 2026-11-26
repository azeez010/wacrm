import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { hasMinRole } from '@/lib/auth/roles'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { parseSourceInput } from '@/lib/ai/ingest/source-input'
import { KNOWLEDGE_LIMITS, nextSyncAt } from '@/lib/ai/ingest/limits'
import { runKnowledgeQueue } from '@/lib/ai/ingest/pipeline'
import {
  IN_REQUEST_BUDGET_MS,
  SOURCE_LIST_COLUMNS,
  sourceInputErrorResponse,
} from '@/lib/ai/ingest/route-helpers'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * GET /api/ai/knowledge/sources  (any member)
 *
 * The knowledge library: every source with its status and counts, and
 * the agents it is linked to.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const [sources, links, agents] = await Promise.all([
      supabase
        .from('ai_knowledge_sources')
        .select(SOURCE_LIST_COLUMNS)
        .eq('account_id', accountId)
        .order('created_at', { ascending: false }),
      supabase.from('ai_agent_knowledge').select('agent_id, source_id').eq('account_id', accountId),
      supabase.from('ai_agents').select('id, name, knowledge_mode').eq('account_id', accountId),
    ])
    if (sources.error) {
      console.error('[ai/knowledge/sources GET] error:', sources.error)
      return NextResponse.json({ error: t('ai.library.loadFailed') }, { status: 500 })
    }
    const agentRows = (agents.data ?? []) as { id: string; name: string; knowledge_mode: string }[]
    const names = new Map(agentRows.map((a) => [a.id, a.name]))
    const bySource = new Map<string, { id: string; name: string }[]>()
    for (const l of (links.data ?? []) as { agent_id: string; source_id: string }[]) {
      const list = bySource.get(l.source_id) ?? []
      list.push({ id: l.agent_id, name: names.get(l.agent_id) ?? '' })
      bySource.set(l.source_id, list)
    }
    // Agents in 'all' mode use every source without links.
    const allAgents = agentRows.filter((a) => a.knowledge_mode === 'all').map((a) => ({ id: a.id, name: a.name }))
    return NextResponse.json({
      sources: (sources.data ?? []).map((s) => ({
        ...s,
        agents: bySource.get((s as { id: string }).id) ?? [],
        all_agents: allAgents,
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/knowledge/sources  (agent+)
 *
 * Add a source to the library: text, Q&A, an uploaded file (its text is
 * extracted in the browser), a web page or a whole website. Indexing
 * starts in this request; big websites finish in the background.
 * An admin may pass `link_agent_id` to link the new source to an agent.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const { supabase, accountId, userId, role } = ctx
    const limit = checkRateLimit(`ai-library:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const parsed = parseSourceInput(body, { accountId })
    if ('error' in parsed) return sourceInputErrorResponse(parsed.error)
    const input = parsed.data

    const { count } = await supabase
      .from('ai_knowledge_sources')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if ((count ?? 0) >= KNOWLEDGE_LIMITS.maxSourcesPerAccount) {
      return NextResponse.json(
        { error: t('ai.library.limitReached', { max: KNOWLEDGE_LIMITS.maxSourcesPerAccount }) },
        { status: 400 },
      )
    }

    const { data: source, error: srcErr } = await supabase
      .from('ai_knowledge_sources')
      .insert({
        account_id: accountId,
        created_by: userId,
        name: input.name,
        type: input.type,
        status: input.type === 'website' ? 'queued' : 'processing',
        config: input.config,
        sync_interval: input.syncInterval,
        next_sync_at: nextSyncAt(input.syncInterval),
      })
      .select('id')
      .single()
    if (srcErr || !source) {
      console.error('[ai/knowledge/sources POST] insert error:', srcErr)
      return NextResponse.json({ error: t('ai.library.saveFailed') }, { status: 500 })
    }

    if (input.document) {
      const { error: docErr } = await supabase.from('ai_knowledge_documents').insert({
        account_id: accountId,
        source_id: source.id,
        created_by: userId,
        title: input.document.title,
        content: input.document.content,
        url: input.document.url,
        status: 'queued',
      })
      if (docErr) {
        console.error('[ai/knowledge/sources POST] document insert error:', docErr)
        await supabase.from('ai_knowledge_sources').delete().eq('id', source.id)
        return NextResponse.json({ error: t('ai.library.saveFailed') }, { status: 500 })
      }
    }

    const linkAgentId = typeof body?.link_agent_id === 'string' ? body.link_agent_id : ''
    if (linkAgentId && hasMinRole(role, 'admin')) {
      const { data: agent } = await supabase
        .from('ai_agents')
        .select('id')
        .eq('id', linkAgentId)
        .eq('account_id', accountId)
        .maybeSingle()
      if (agent) {
        await supabase
          .from('ai_agent_knowledge')
          .insert({ agent_id: agent.id, source_id: source.id, account_id: accountId })
      }
    }

    // Index now (bounded); the cron picks up whatever is left.
    await runKnowledgeQueue(supabaseAdmin(), {
      deadline: Date.now() + IN_REQUEST_BUDGET_MS,
      onlySourceId: source.id,
    })

    const { data: fresh } = await supabase
      .from('ai_knowledge_sources')
      .select(SOURCE_LIST_COLUMNS)
      .eq('id', source.id)
      .single()
    return NextResponse.json({ source: fresh }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
