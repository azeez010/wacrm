import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getT } from '@/lib/i18n/translate'
import { setConversationAgent } from '@/lib/ai/service'

const t = getT('Api')

type Params = { params: Promise<{ conversationId: string }> }

/**
 * PUT /api/ai/conversations/[conversationId]/agent  (agent+)
 *
 * Body: { agent_id: string | null } - pin which AI agent answers this
 * conversation; null goes back to automatic (channel, then default).
 */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`ai-conv-agent:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)
    const { conversationId } = await params

    const body = await request.json().catch(() => null)
    if (!body || !('agent_id' in body)) {
      return NextResponse.json({ error: t('common.invalidRequestBody') }, { status: 400 })
    }
    const agentId = typeof body.agent_id === 'string' && body.agent_id ? body.agent_id : null

    const r = await setConversationAgent(supabase, accountId, conversationId, agentId)
    if (!r.ok) {
      if (r.code === 'not_found' && agentId) {
        // Either the agent or the conversation is missing; say which.
        const { data: agent } = await supabase.from('ai_agents').select('id').eq('id', agentId).eq('account_id', accountId).maybeSingle()
        if (!agent) return NextResponse.json({ error: t('ai.agents.notFound') }, { status: 404 })
      }
      if (r.code === 'not_found') return NextResponse.json({ error: t('common.conversationNotFound') }, { status: 404 })
      return NextResponse.json({ error: t('ai.updateConversationFailed') }, { status: 500 })
    }
    return NextResponse.json({ agent_id: agentId })
  } catch (err) {
    return toErrorResponse(err)
  }
}
