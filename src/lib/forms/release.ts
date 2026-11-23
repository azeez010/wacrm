// ============================================================
// Release held leads: leads that arrived over the monthly quota are kept but not processed.
// This accepts as many as the plan has room for (oldest first) and re-runs the normal pipeline
// for each (contact, tags, notification, welcome message...). Shared by the dashboard and the API.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { getLimit } from '@/lib/billing/entitlements'
import { monthStartUtc } from '@/lib/billing/usage'
import { reprocessSubmission } from './submit'
import type { FormRow } from './types'

/** Per call: keeps one request (and the background work it starts) bounded. */
export const RELEASE_BATCH = 200

export interface ReleaseResult {
  released: number
  stillHeld: number
  /** Why some stayed held: 'plan_limit' when the plan has no more room this month. */
  reason: 'plan_limit' | 'batch' | null
  /** The background work (run it inside `after()`). */
  run: () => Promise<void>
}

/** `db` must be the service-role client. */
export async function releaseHeldLeads(db: SupabaseClient, form: FormRow, now: Date = new Date()): Promise<ReleaseResult> {
  const { data: held } = await db
    .from('form_submissions')
    .select('*')
    .eq('form_id', form.id)
    .eq('account_id', form.account_id)
    .eq('outcome', 'held')
    .eq('is_test', false)
    .order('created_at', { ascending: true })
    .limit(RELEASE_BATCH + 1)
  const rows = (held ?? []) as { id: string }[]
  if (rows.length === 0) return { released: 0, stillHeld: 0, reason: null, run: async () => undefined }

  // Room left this month: the plan limit minus what is already accepted (all forms).
  const limit = (await getLimit(db, form.account_id, 'form_submissions_per_month')).limit
  let room = rows.length
  if (limit !== null) {
    const { data: counts } = await db.rpc('count_form_submissions', { p_account: form.account_id, p_since: monthStartUtc(now).toISOString() })
    room = Math.max(0, limit - Number((counts as { accepted?: number } | null)?.accepted ?? 0))
  }
  const batch = rows.slice(0, Math.min(RELEASE_BATCH, room))
  if (batch.length === 0) return { released: 0, stillHeld: rows.length, reason: 'plan_limit', run: async () => undefined }

  const ids = batch.map((r) => r.id)
  const { error } = await db.from('form_submissions').update({ outcome: 'accepted' }).in('id', ids).eq('outcome', 'held')
  if (error) throw new Error(error.message)

  const stillHeld = rows.length - batch.length
  return {
    released: batch.length,
    stillHeld,
    reason: stillHeld === 0 ? null : room < rows.length ? 'plan_limit' : 'batch',
    run: async () => {
      for (const sub of batch as unknown as Parameters<typeof reprocessSubmission>[2][]) {
        try {
          await reprocessSubmission(db, form, sub, { onlyFailed: false, now })
        } catch (err) {
          console.error('[forms] release failed for a lead:', err instanceof Error ? err.message : err)
        }
      }
    },
  }
}
