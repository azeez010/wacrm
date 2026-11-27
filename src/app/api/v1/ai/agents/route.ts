// /api/v1/ai/agents
//   GET  (ai:read)  the workspace's AI agents, default first, with how many knowledge sources each is linked to
//   POST (ai:write) create an agent (the first one becomes the default). Provider keys stay in the app.
import { requireApiKey } from '@/lib/auth/api-context'
import { createAgent, listAgents } from '@/lib/ai/service'
import { aiResult } from '@/lib/api/v1/ai'
import { toApiErrorResponse } from '@/lib/api/v1/respond'

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'ai:read')
    return aiResult(await listAgents(ctx.supabase, ctx.accountId))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'ai:write')
    return aiResult(await createAgent(ctx.supabase, ctx.accountId, ctx.createdBy, await request.json().catch(() => null)), 201)
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
