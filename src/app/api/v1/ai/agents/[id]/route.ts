// /api/v1/ai/agents/{id}
//   GET    (ai:read)  the agent and its linked knowledge source ids
//   PATCH  (ai:write) update any subset of its fields
//   DELETE (ai:write) delete it (never the default agent)
import { requireApiKey } from '@/lib/auth/api-context'
import { deleteAgent, getAgent, updateAgent } from '@/lib/ai/service'
import { aiResult } from '@/lib/api/v1/ai'
import { toApiErrorResponse } from '@/lib/api/v1/respond'

type Params = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await requireApiKey(request, 'ai:read')
    return aiResult(await getAgent(ctx.supabase, ctx.accountId, (await params).id))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireApiKey(request, 'ai:write')
    return aiResult(await updateAgent(ctx.supabase, ctx.accountId, (await params).id, await request.json().catch(() => null)))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const ctx = await requireApiKey(request, 'ai:write')
    return aiResult(await deleteAgent(ctx.supabase, ctx.accountId, (await params).id))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
