import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The platform admin console can pause AI for the whole platform (kill switch) or for one business.
 * `public.ai_admin_gate(account)` (migration 096) answers; this wraps it with a short cache.
 *
 * Fails OPEN on any error (function missing during a rollout, database hiccup): a problem with the
 * switch must never silently stop a business's replies. The cost is that the switch can lag by up to
 * the cache TTL (30 s) per server instance, which is acceptable for an emergency stop.
 */
export interface AiGate {
  allowed: boolean
  /** Why it is blocked: the whole platform, or just this business. null when allowed. */
  scope: 'platform' | 'account' | null
}

export const AI_ADMIN_GATE_TTL_MS = 30_000

const OPEN: AiGate = { allowed: true, scope: null }
const cache = new Map<string, { gate: AiGate; expiresAt: number }>()

export function invalidateAiAdminGate(accountId?: string): void {
  if (accountId) cache.delete(accountId)
  else cache.clear()
}

export async function checkAiAdminGate(
  db: SupabaseClient,
  accountId: string,
  now: () => number = Date.now,
): Promise<AiGate> {
  const hit = cache.get(accountId)
  if (hit && hit.expiresAt > now()) return hit.gate
  try {
    const { data, error } = await db.rpc('ai_admin_gate', { p_account: accountId })
    if (error || !data || typeof data !== 'object') return OPEN
    const raw = data as { allowed?: unknown; scope?: unknown }
    const gate: AiGate =
      raw.allowed === false
        ? { allowed: false, scope: raw.scope === 'platform' ? 'platform' : 'account' }
        : OPEN
    cache.set(accountId, { gate, expiresAt: now() + AI_ADMIN_GATE_TTL_MS })
    return gate
  } catch {
    return OPEN
  }
}
