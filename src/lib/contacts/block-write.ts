import type { SupabaseClient } from '@supabase/supabase-js'

import type { BlockReason } from './block-guard'

/**
 * The one place that flips a contact's blocked state. Used by the dashboard
 * route, the public API / MCP, CSV import and the automation steps, so they
 * all behave the same (idempotent, account-scoped).
 *
 * Returns `changed: false` when the contact was already in the requested
 * state, so bulk callers can count it as skipped.
 */
export async function setContactBlocked(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    blocked: boolean
    reason?: BlockReason
    userId?: string | null
  },
): Promise<{ changed: boolean; found: boolean }> {
  const { accountId, contactId, blocked } = args
  const patch = blocked
    ? {
        blocked_at: new Date().toISOString(),
        blocked_reason: args.reason ?? 'manual',
        blocked_by: args.userId ?? null,
      }
    : { blocked_at: null, blocked_reason: null, blocked_by: null }

  // Only touch rows that are not already in the target state.
  let q = db
    .from('contacts')
    .update(patch)
    .eq('id', contactId)
    .eq('account_id', accountId)
  q = blocked ? q.is('blocked_at', null) : q.not('blocked_at', 'is', null)
  const { data, error } = await q.select('id')
  if (error) throw new Error(error.message)
  if (data && data.length > 0) return { changed: true, found: true }

  const { data: exists } = await db
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  return { changed: false, found: Boolean(exists) }
}
