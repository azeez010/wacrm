// ============================================================
// The CRM outbox: a durable queue of jobs (sync a contact, track an event,
// send an email) so a slow or failing provider never breaks the user's request
// and nothing is lost. Jobs are drained with flushOutbox(), which is triggered
// after each enqueue (via after()) and by the secret-guarded /api/crm/flush
// endpoint for an external scheduler (Workers have no cron here).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildContactSnapshot } from './snapshot'
import { getCrmProvider, getEmailProvider } from './registry'
import { CrmError, type EmailMessage } from './types'

export type OutboxKind = 'contact' | 'event' | 'email'

export interface OutboxRow {
  id: string
  kind: OutboxKind
  user_id: string | null
  account_id: string | null
  dedupe_key: string | null
  payload: Record<string, unknown>
  attempts: number
  created_at: string
}

export interface EnqueueInput {
  kind: OutboxKind
  userId?: string | null
  accountId?: string | null
  /** At most one pending job per key; repeats are collapsed. */
  dedupeKey?: string | null
  payload?: Record<string, unknown>
}

/** Seconds to wait before attempt N+1 after attempt N failed. */
export const BACKOFF_SECONDS = [60, 300, 1800, 7200, 43200] as const
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1
const KEEP_SENT_DAYS = 14
// Jobs with a dedupe key are kept longer: "once per month" guards rely on them.
const KEEP_KEYED_DAYS = 45

/** Returns false when an identical job is already pending (collapsed). */
export async function enqueue(db: SupabaseClient, input: EnqueueInput): Promise<boolean> {
  const { error } = await db.from('crm_outbox').insert({
    kind: input.kind,
    user_id: input.userId ?? null,
    account_id: input.accountId ?? null,
    dedupe_key: input.dedupeKey ?? null,
    payload: input.payload ?? {},
  })
  if (error) {
    if (error.code === '23505') return false
    throw new Error(`crm_outbox insert failed: ${error.message}`)
  }
  return true
}

/**
 * Enqueue unless a job with this key already exists in ANY state. For "once per
 * month" style notices (the key carries the month). Finished once-jobs are kept
 * long enough to cover the period (see the purge in flushOutbox).
 */
export async function enqueueOnce(db: SupabaseClient, input: EnqueueInput & { dedupeKey: string }): Promise<boolean> {
  const { data } = await db.from('crm_outbox').select('id').eq('dedupe_key', input.dedupeKey).limit(1)
  if (data && data.length > 0) return false
  return enqueue(db, input)
}

async function recipientEmail(db: SupabaseClient, row: OutboxRow): Promise<string | null> {
  let userId = row.user_id
  if (!userId && row.account_id) {
    const { data } = await db.from('accounts').select('owner_user_id').eq('id', row.account_id).maybeSingle()
    userId = (data?.owner_user_id as string | null) ?? null
  }
  if (!userId) return null
  const { data } = await db.from('profiles').select('email').eq('user_id', userId).maybeSingle()
  return (data?.email as string | null)?.toLowerCase() ?? null
}

type Outcome = 'sent' | 'skipped'

async function handle(db: SupabaseClient, row: OutboxRow): Promise<Outcome> {
  if (row.kind === 'contact') {
    const crm = getCrmProvider()
    if (!crm) throw new CrmError('CRM provider is not configured', false)
    if (!row.user_id) return 'skipped'
    const snapshot = await buildContactSnapshot(db, row.user_id)
    if (!snapshot) return 'skipped'
    await crm.upsertContact(snapshot)
    return 'sent'
  }

  if (row.kind === 'event') {
    const crm = getCrmProvider()
    if (!crm) throw new CrmError('CRM provider is not configured', false)
    const email = await recipientEmail(db, row)
    if (!email) return 'skipped'
    const p = row.payload as { name: string; at?: string; properties?: Record<string, string | number | boolean> }
    await crm.trackEvent({ name: p.name, email, at: p.at, properties: p.properties })
    return 'sent'
  }

  const mail = getEmailProvider()
  if (!mail) throw new CrmError('Email provider is not configured', false)
  await mail.send(row.payload as unknown as EmailMessage)
  return 'sent'
}

export interface FlushResult {
  claimed: number
  sent: number
  retried: number
  dead: number
}

/** Process up to `limit` due jobs. Safe to call concurrently. */
export async function flushOutbox(db: SupabaseClient, limit = 10, nowMs: number = Date.now()): Promise<FlushResult> {
  const result: FlushResult = { claimed: 0, sent: 0, retried: 0, dead: 0 }
  // Nothing configured: leave the queue alone (jobs wait for configuration).
  if (!getCrmProvider() && !getEmailProvider()) return result

  const { data, error } = await db.rpc('crm_claim_outbox', { p_limit: limit })
  if (error) {
    console.error('[crm] claim failed:', error.message)
    return result
  }
  const rows = ((data ?? []) as OutboxRow[]).slice()
  result.claimed = rows.length
  // A contact must exist before events about it, and emails go last.
  const order: Record<OutboxKind, number> = { contact: 0, event: 1, email: 2 }
  rows.sort((a, b) => order[a.kind] - order[b.kind] || a.created_at.localeCompare(b.created_at))

  for (const row of rows) {
    try {
      const outcome = await handle(db, row)
      await db
        .from('crm_outbox')
        .update({ status: 'sent', sent_at: new Date(nowMs).toISOString(), locked_at: null, last_error: outcome === 'skipped' ? 'skipped: nothing to do' : null })
        .eq('id', row.id)
      result.sent++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const retryable = err instanceof CrmError ? err.retryable : true
      if (!retryable || row.attempts >= MAX_ATTEMPTS) {
        await db.from('crm_outbox').update({ status: 'dead', locked_at: null, last_error: message }).eq('id', row.id)
        result.dead++
        console.error(`[crm] job ${row.id} (${row.kind}) gave up: ${message}`)
      } else {
        const wait = BACKOFF_SECONDS[Math.min(row.attempts, BACKOFF_SECONDS.length) - 1]
        await db
          .from('crm_outbox')
          .update({ status: 'pending', locked_at: null, last_error: message, next_attempt_at: new Date(nowMs + wait * 1000).toISOString() })
          .eq('id', row.id)
        result.retried++
      }
    }
  }

  // Housekeeping: drop old finished jobs.
  await db
    .from('crm_outbox')
    .delete()
    .eq('status', 'sent')
    .is('dedupe_key', null)
    .lt('sent_at', new Date(nowMs - KEEP_SENT_DAYS * 86400_000).toISOString())
  await db
    .from('crm_outbox')
    .delete()
    .eq('status', 'sent')
    .lt('sent_at', new Date(nowMs - KEEP_KEYED_DAYS * 86400_000).toISOString())
  return result
}
