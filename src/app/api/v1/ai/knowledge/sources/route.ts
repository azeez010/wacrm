// /api/v1/ai/knowledge/sources
//   GET  (ai:read)  the knowledge library with status, counts and linked agent ids
//   POST (ai:write) add a text, qa, url or website source (optional link_agent_id); indexing starts right away
import { requireApiKey } from '@/lib/auth/api-context'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { createSource, listSources } from '@/lib/ai/service'
import { aiResult } from '@/lib/api/v1/ai'
import { toApiErrorResponse } from '@/lib/api/v1/respond'

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'ai:read')
    return aiResult(await listSources(ctx.supabase, ctx.accountId))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'ai:write')
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const link = typeof body?.link_agent_id === 'string' ? body.link_agent_id : null
    return aiResult(await createSource(ctx.supabase, supabaseAdmin(), ctx.accountId, ctx.createdBy, body, { linkAgentId: link }), 201)
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
