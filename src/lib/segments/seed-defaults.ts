import { supabaseAdmin } from '@/lib/automations/admin-client'
import { FILTER_VERSION } from './types'

export const BLOCKED_SEGMENT_KEY = 'segment_blocked'
export const NOT_BLOCKED_SEGMENT_KEY = 'segment_not_blocked'

const DEFAULT_SEGMENTS = [
  { key: BLOCKED_SEGMENT_KEY, name: 'Blocked', operator: 'is_true' },
  { key: NOT_BLOCKED_SEGMENT_KEY, name: 'Not blocked', operator: 'is_false' },
] as const

/**
 * Create the account's default "Blocked" / "Not blocked" segments once.
 * Recorded in `accounts.seeded_defaults` (shared with the default automations),
 * so a segment the user deletes is never recreated. They are ordinary,
 * editable, deletable segments (`locked: false`). A name clash with a segment
 * the user already made is treated as done. Run it after
 * ensureDefaultAutomations: it re-reads `seeded_defaults` so it never writes a
 * stale list over that one.
 */
export async function ensureDefaultSegments(
  accountId: string,
  userId: string,
): Promise<{ created: string[] }> {
  const admin = supabaseAdmin()
  const { data: account } = await admin
    .from('accounts')
    .select('seeded_defaults')
    .eq('id', accountId)
    .maybeSingle()
  if (!account) return { created: [] }
  const seeded: string[] = account.seeded_defaults ?? []
  const created: string[] = []
  const done = [...seeded]

  for (const def of DEFAULT_SEGMENTS) {
    if (seeded.includes(def.key)) continue
    const { error } = await admin.from('segments').insert({
      account_id: accountId,
      name: def.name,
      description: null,
      filter: {
        version: FILTER_VERSION,
        op: 'and',
        rules: [{ field: 'blocked', operator: def.operator }],
      },
      source: 'system',
      locked: false,
      created_by: userId,
    })
    // 23505 = a segment with this name already exists (ours from a racing
    // request, or the user's own): nothing more to create.
    if (error && error.code !== '23505') throw new Error(error.message)
    if (!error) created.push(def.key)
    done.push(def.key)
  }

  if (done.length !== seeded.length) {
    await admin.from('accounts').update({ seeded_defaults: done }).eq('id', accountId)
  }
  return { created }
}
