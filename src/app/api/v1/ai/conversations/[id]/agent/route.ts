// PUT /api/v1/ai/conversations/{id}/agent (ai:write) - { agent_id } pins which AI agent answers this conversation;
// null goes back to automatic (channel, then the default agent).
import { requireApiKey } from '@/lib/auth/api-context'
import { setConversationAgent } from '@/lib/ai/service'
import { aiResult } from '@/lib/api/v1/ai'
import { fail, toApiErrorResponse } from '@/lib/api/v1/respond'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'ai:write')
    const body = (await request.json().catch(() => null)) as { agent_id?: unknown } | null
    if (!body || !('agent_id' in body)) return fail('bad_request', 'agent_id is required (null for automatic)', 400)
    const agentId = typeof body.agent_id === 'string' && body.agent_id ? body.agent_id : null
    return aiResult(await setConversationAgent(ctx.supabase, ctx.accountId, (await params).id, agentId))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
