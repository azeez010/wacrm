import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { agentServiceErrorResponse } from '@/lib/ai/agent-route-helpers'
import { createAgent, listAgents } from '@/lib/ai/service'

/**
 * GET /api/ai/agents  (any member)
 *
 * The account's AI agents, default first, each with how many library
 * sources it is linked to.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const r = await listAgents(supabase, accountId)
    if (!r.ok) return agentServiceErrorResponse(r, 'ai.agents.loadFailed')
    return NextResponse.json({ agents: r.data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/agents  (admin+)
 *
 * Create an agent. Provider and keys stay workspace-wide (ai_configs);
 * an agent only overrides the model.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-agents:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const r = await createAgent(supabase, accountId, userId, await request.json().catch(() => null))
    if (!r.ok) return agentServiceErrorResponse(r, 'ai.agents.saveFailed')
    return NextResponse.json({ agent: r.data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
