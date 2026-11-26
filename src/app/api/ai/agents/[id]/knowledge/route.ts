import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { parseIdList } from '@/lib/ai/agent-input'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

type Params = { params: Promise<{ id: string }> }

/**
 * PUT /api/ai/agents/[id]/knowledge  (admin+)
 *
 * Body: { source_ids: string[] } - replaces the agent's linked library
 * sources. Every id must be a source in this account.
 */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-agents:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params

    const body = await request.json().catch(() => null)
    const sourceIds = parseIdList(body?.source_ids)
    if (!sourceIds) {
      return NextResponse.json({ error: t('ai.agents.sourceIdsRequired') }, { status: 400 })
    }

    const { data: agent } = await supabase
      .from('ai_agents')
      .select('id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!agent) return NextResponse.json({ error: t('ai.agents.notFound') }, { status: 404 })

    if (sourceIds.length > 0) {
      const { data: found } = await supabase
        .from('ai_knowledge_sources')
        .select('id')
        .eq('account_id', accountId)
        .in('id', sourceIds)
      if ((found ?? []).length !== sourceIds.length) {
        return NextResponse.json({ error: t('ai.agents.unknownSources') }, { status: 400 })
      }
    }

    const { data: current } = await supabase
      .from('ai_agent_knowledge')
      .select('source_id')
      .eq('agent_id', id)
    const have = new Set(((current ?? []) as { source_id: string }[]).map((l) => l.source_id))
    const want = new Set(sourceIds)
    const toAdd = sourceIds.filter((s) => !have.has(s))
    const toRemove = [...have].filter((s) => !want.has(s))

    if (toAdd.length > 0) {
      const { error } = await supabase
        .from('ai_agent_knowledge')
        .insert(toAdd.map((source_id) => ({ agent_id: id, source_id, account_id: accountId })))
      if (error) {
        console.error('[ai/agents/:id/knowledge PUT] insert error:', error)
        return NextResponse.json({ error: t('ai.agents.linkFailed') }, { status: 500 })
      }
    }
    if (toRemove.length > 0) {
      const { error } = await supabase
        .from('ai_agent_knowledge')
        .delete()
        .eq('agent_id', id)
        .in('source_id', toRemove)
      if (error) {
        console.error('[ai/agents/:id/knowledge PUT] delete error:', error)
        return NextResponse.json({ error: t('ai.agents.linkFailed') }, { status: 500 })
      }
    }
    return NextResponse.json({ source_ids: sourceIds })
  } catch (err) {
    return toErrorResponse(err)
  }
}
