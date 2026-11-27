// PUT /api/v1/ai/agents/{id}/knowledge (ai:write) - { source_ids } replaces the sources the agent uses when its
// knowledge_mode is 'selected'.
import { requireApiKey } from '@/lib/auth/api-context'
import { setAgentKnowledge } from '@/lib/ai/service'
import { aiResult } from '@/lib/api/v1/ai'
import { toApiErrorResponse } from '@/lib/api/v1/respond'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'ai:write')
    const body = (await request.json().catch(() => null)) as { source_ids?: unknown } | null
    return aiResult(await setAgentKnowledge(ctx.supabase, ctx.accountId, (await params).id, body?.source_ids))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
