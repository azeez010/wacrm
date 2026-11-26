// ============================================================
// Passive WhatsApp reachability per contact, from what Meta already tells us.
//
//   active      the number messaged us, or a message to it was delivered / read
//   unreachable a send failed with Meta error 131026 ("unable to deliver": not on
//               WhatsApp, has not accepted WhatsApp's new terms, or a very old app)
//
// No lookup service and no extra sends: these are side effects of traffic that
// happens anyway. Writes are best effort: a failure here never breaks the webhook.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { normalizePhone, phoneVariants } from './phone-utils'

/** Meta's "Message undeliverable" error. */
export const UNDELIVERABLE_CODE = 131026

/** A recent sign of life protects a number from being marked unreachable by one failure. */
export const ACTIVE_GRACE_DAYS = 30

/** Refresh an existing "active" at most this often (delivery receipts are frequent). */
const ACTIVE_REFRESH_MS = 24 * 60 * 60 * 1000

export type WaStatus = 'active' | 'unreachable'

export interface WaState {
  wa_status: WaStatus | null
  wa_status_at: string | null
}

/** Should a 131026 failure mark this contact unreachable? Pure. */
export function shouldMarkUnreachable(current: WaState, now: Date = new Date()): boolean {
  if (current.wa_status !== 'active' || !current.wa_status_at) return true
  return now.getTime() - new Date(current.wa_status_at).getTime() > ACTIVE_GRACE_DAYS * 86_400_000
}

/** Does a sign of life need a write? Skips redundant writes for an already-fresh "active". Pure. */
export function shouldMarkActive(current: WaState, now: Date = new Date()): boolean {
  if (current.wa_status !== 'active' || !current.wa_status_at) return true
  return now.getTime() - new Date(current.wa_status_at).getTime() > ACTIVE_REFRESH_MS
}

type Source = 'inbound' | 'delivered' | 'read' | 'failed_131026'

async function contactsForPhone(db: SupabaseClient, accountId: string, phone: string) {
  const digits = normalizePhone(phone)
  if (!digits) return []
  const { data } = await db
    .from('contacts')
    .select('id, wa_status, wa_status_at')
    .eq('account_id', accountId)
    .in('phone_normalized', phoneVariants(digits))
  return (data ?? []) as ({ id: string } & WaState)[]
}

async function write(db: SupabaseClient, ids: string[], status: WaStatus, source: Source, now: Date) {
  if (ids.length === 0) return
  await db
    .from('contacts')
    .update({ wa_status: status, wa_status_at: now.toISOString(), wa_status_source: source })
    .in('id', ids)
}

/** The contact messaged us: it is certainly on WhatsApp. */
export async function markContactActive(db: SupabaseClient, contact: { id: string } & Partial<WaState>, now: Date = new Date()): Promise<void> {
  try {
    const current: WaState = { wa_status: contact.wa_status ?? null, wa_status_at: contact.wa_status_at ?? null }
    if (contact.wa_status === undefined) {
      const { data } = await db.from('contacts').select('wa_status, wa_status_at').eq('id', contact.id).maybeSingle()
      if (data) Object.assign(current, data)
    }
    if (shouldMarkActive(current, now)) await write(db, [contact.id], 'active', 'inbound', now)
  } catch (err) {
    console.warn('[number-status] could not mark active:', err instanceof Error ? err.message : err)
  }
}

/**
 * A delivery receipt for a message we sent to `recipientPhone` (Meta's `recipient_id`, digits).
 * delivered / read = active; failed with 131026 = unreachable (unless recently active).
 */
export async function recordDeliveryStatus(
  db: SupabaseClient,
  accountId: string,
  recipientPhone: string | null | undefined,
  status: string,
  errorCode: number | null | undefined,
  now: Date = new Date(),
): Promise<void> {
  if (!recipientPhone) return
  const isLife = status === 'delivered' || status === 'read'
  const isGhost = status === 'failed' && errorCode === UNDELIVERABLE_CODE
  if (!isLife && !isGhost) return
  try {
    const rows = await contactsForPhone(db, accountId, recipientPhone)
    if (isLife) {
      await write(db, rows.filter((r) => shouldMarkActive(r, now)).map((r) => r.id), 'active', status as Source, now)
    } else {
      await write(db, rows.filter((r) => shouldMarkUnreachable(r, now)).map((r) => r.id), 'unreachable', 'failed_131026', now)
    }
  } catch (err) {
    console.warn('[number-status] could not record a delivery status:', err instanceof Error ? err.message : err)
  }
}
