import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { agentServiceErrorResponse } from '@/lib/ai/agent-route-helpers'
import { setAgentKnowledge } from '@/lib/ai/service'

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
    const body = await request.json().catch(() => null)
    const r = await setAgentKnowledge(supabase, accountId, (await params).id, body?.source_ids)
    if (!r.ok) return agentServiceErrorResponse(r, 'ai.agents.linkFailed')
    return NextResponse.json(r.data)
  } catch (err) {
    return toErrorResponse(err)
  }
}
