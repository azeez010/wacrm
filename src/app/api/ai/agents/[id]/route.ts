import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { agentServiceErrorResponse } from '@/lib/ai/agent-route-helpers'
import { deleteAgent, getAgent, updateAgent } from '@/lib/ai/service'

type Params = { params: Promise<{ id: string }> }

/** GET /api/ai/agents/[id]  (any member): the agent and its linked sources. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const r = await getAgent(supabase, accountId, (await params).id)
    if (!r.ok) return agentServiceErrorResponse(r, 'ai.agents.loadFailed')
    return NextResponse.json({ agent: r.data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PATCH /api/ai/agents/[id]  (admin+): update any subset of the fields. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-agents:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const r = await updateAgent(supabase, accountId, (await params).id, await request.json().catch(() => null))
    if (!r.ok) return agentServiceErrorResponse(r, 'ai.agents.saveFailed')
    return NextResponse.json({ agent: r.data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/ai/agents/[id]  (admin+). The default agent can't be deleted. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const r = await deleteAgent(supabase, accountId, (await params).id)
    if (!r.ok) return agentServiceErrorResponse(r, 'ai.agents.deleteFailed')
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
