// GET /api/v1/ai/usage (ai:read) - OgaDesk AI credits used this month against the plan (a workspace using its own
// provider key is not limited) and token totals for the last 30 days.
import { requireApiKey } from '@/lib/auth/api-context'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { ok, toApiErrorResponse } from '@/lib/api/v1/respond'

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'ai:read')
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const [credit, rows] = await Promise.all([
      supabaseAdmin().rpc('ai_credit_status', { p_account: ctx.accountId }),
      ctx.supabase.from('ai_usage_log').select('mode, total_tokens').eq('account_id', ctx.accountId).gte('created_at', since).limit(10_000),
    ])
    const c = (credit.data ?? {}) as { used?: number; limit?: number | null; reason?: string; own_key?: boolean }
    const list = (rows.data ?? []) as { mode: string; total_tokens: number }[]
    const byMode: Record<string, { calls: number; tokens: number }> = {}
    let tokens = 0
    for (const r of list) {
      tokens += r.total_tokens
      byMode[r.mode] = { calls: (byMode[r.mode]?.calls ?? 0) + 1, tokens: (byMode[r.mode]?.tokens ?? 0) + r.total_tokens }
    }
    return ok({
      credits: { used: Number(c.used ?? 0), limit: c.reason === 'plan_feature' ? 0 : typeof c.limit === 'number' ? c.limit : null, status: c.reason ?? 'ok' },
      last_30_days: { calls: list.length, tokens, by_mode: byMode, truncated: list.length >= 10_000 },
    })
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
