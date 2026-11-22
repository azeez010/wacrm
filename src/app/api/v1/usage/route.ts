// ============================================================
// GET /api/v1/usage - your plan and how much of it you have used.
//
// Needs a valid key but no scope, like /me. Handy for dashboards and for
// stopping before you hit a limit instead of after a 402.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context'
import { ok, toApiErrorResponse } from '@/lib/api/v1/respond'
import { getEntitlements } from '@/lib/billing/entitlements'
import { countBillableMessages, monthStartUtc, nextMonthStartUtc } from '@/lib/billing/usage'

function meter(limit: unknown, used: number) {
  const l = typeof limit === 'number' ? limit : null
  return { limit: l, used, remaining: l === null ? null : Math.max(0, l - used) }
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request)
    const [ents, messages, keys, webhooks, numbers] = await Promise.all([
      getEntitlements(ctx.supabase, ctx.accountId),
      countBillableMessages(ctx.supabase, ctx.accountId),
      ctx.supabase.from('api_keys').select('id', { count: 'exact', head: true }).eq('account_id', ctx.accountId).is('revoked_at', null),
      ctx.supabase.from('webhook_endpoints').select('id', { count: 'exact', head: true }).eq('account_id', ctx.accountId),
      ctx.supabase.from('whatsapp_config').select('id', { count: 'exact', head: true }).eq('account_id', ctx.accountId),
    ])
    return ok({
      plan: ents.planName,
      period: { start: monthStartUtc().toISOString(), end: nextMonthStartUtc().toISOString() },
      messages: meter(ents.limits.messages_per_month, messages),
      api_keys: meter(ents.limits.api_keys, keys.count ?? 0),
      webhook_endpoints: meter(ents.limits.webhook_endpoints, webhooks.count ?? 0),
      whatsapp_numbers: meter(ents.limits.whatsapp_connections, numbers.count ?? 0),
    })
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
