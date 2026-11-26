import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The platform admin console can suspend a whole business. `public.account_suspension_gate(account)`
 * (migration 107) answers; this wraps it with a short cache.
 *
 * Fails OPEN on any error (function missing during a rollout, database hiccup): a problem with the
 * switch must never lock paying customers out. The cost is that a suspension can lag by up to the cache
 * TTL (30 s) per server instance.
 */
export interface SuspensionState {
  suspended: boolean
  /** What the customer is told. null when not suspended. */
  message: string | null
}

export const SUSPENSION_TTL_MS = 30_000

export class AccountSuspendedError extends Error {
  readonly status = 403 as const
  readonly code = 'account_suspended' as const
  constructor(message: string) {
    super(message)
    this.name = 'AccountSuspendedError'
  }
}

const OPEN: SuspensionState = { suspended: false, message: null }
const cache = new Map<string, { state: SuspensionState; expiresAt: number }>()

export function invalidateSuspension(accountId?: string): void {
  if (accountId) cache.delete(accountId)
  else cache.clear()
}

export async function checkAccountSuspension(
  db: SupabaseClient,
  accountId: string,
  now: () => number = Date.now,
): Promise<SuspensionState> {
  const hit = cache.get(accountId)
  if (hit && hit.expiresAt > now()) return hit.state
  try {
    const { data, error } = await db.rpc('account_suspension_gate', { p_account: accountId })
    if (error || !data || typeof data !== 'object') return OPEN
    const raw = data as { suspended?: unknown; message?: unknown }
    const state: SuspensionState =
      raw.suspended === true
        ? { suspended: true, message: typeof raw.message === 'string' && raw.message ? raw.message : 'This workspace has been paused.' }
        : OPEN
    cache.set(accountId, { state, expiresAt: now() + SUSPENSION_TTL_MS })
    return state
  } catch {
    return OPEN
  }
}

/** Throws AccountSuspendedError when the business is suspended; resolves silently otherwise (and on any error). */
export async function assertAccountNotSuspended(db: SupabaseClient, accountId: string): Promise<void> {
  const s = await checkAccountSuspension(db, accountId)
  if (s.suspended) throw new AccountSuspendedError(s.message ?? 'This workspace has been paused.')
}
