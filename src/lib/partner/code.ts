import type { SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

// Every user is a partner. Codes are upper-case so links match whatever case a
// visitor types; the DB enforces ^[A-Z0-9_-]{3,32}$ and uniqueness.

export const CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/

export function normalizeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return CODE_PATTERN.test(code) ? code : null
}

/** e.g. "Ada Lovelace" → "ADALOVELAC7F3A" (name part max 10 chars + 4 random hex). */
export function generateCode(displayName: string | null | undefined): string {
  const slug = String(displayName ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10) || 'OGA'
  return slug + randomBytes(2).toString('hex').toUpperCase()
}

export interface PartnerRow {
  user_id: string
  code: string
  display_name: string | null
  show_on_leaderboard: boolean
  payout_details: Record<string, unknown>
  status: 'active' | 'suspended'
  clicks?: number | string
  created_at: string
}

/** The user's partner row, created on first use. Safe under concurrent calls. */
export async function ensurePartner(db: SupabaseClient, userId: string, displayName?: string | null): Promise<PartnerRow> {
  const read = async () => {
    const { data } = await db.from('partners').select('*').eq('user_id', userId).maybeSingle()
    return (data as PartnerRow | null) ?? null
  }
  const existing = await read()
  if (existing) return existing

  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await db
      .from('partners')
      .insert({ user_id: userId, code: generateCode(displayName), display_name: displayName?.trim() || null })
    if (!error) break
    const row = await read() // lost a race for this user, or the code collided
    if (row) return row
  }
  const created = await read()
  if (!created) throw new Error('Could not create partner profile')
  return created
}
