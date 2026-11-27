// POST /api/v1/ai/knowledge/search (ai:read) - { query, agent_id? }: what an agent would be given for this question
// (retrieval only, no AI call, no credits).
import { requireApiKey } from '@/lib/auth/api-context'
import { searchKnowledge } from '@/lib/ai/service'
import { aiResult } from '@/lib/api/v1/ai'
import { toApiErrorResponse } from '@/lib/api/v1/respond'

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'ai:read')
    return aiResult(await searchKnowledge(ctx.supabase, ctx.accountId, await request.json().catch(() => null)))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
