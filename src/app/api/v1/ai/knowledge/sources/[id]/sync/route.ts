// POST /api/v1/ai/knowledge/sources/{id}/sync (ai:write) - re-sync now (pages fetched again, text re-embedded).
import { requireApiKey } from '@/lib/auth/api-context'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { syncSource } from '@/lib/ai/service'
import { aiResult } from '@/lib/api/v1/ai'
import { checkRateLimit } from '@/lib/rate-limit'
import { fail, toApiErrorResponse } from '@/lib/api/v1/respond'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'ai:write')
    const rl = checkRateLimit(`apikey:ai-sync:${ctx.keyId}`, { limit: 10, windowMs: 60_000 })
    if (!rl.success) return fail('rate_limited', 'Too many syncs; try again in a minute', 429)
    return aiResult(await syncSource(ctx.supabase, supabaseAdmin(), ctx.accountId, (await params).id))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
