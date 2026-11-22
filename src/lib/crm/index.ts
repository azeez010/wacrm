// Public entry points for the rest of the app. Every function here is safe to
// call on a hot path: it never throws, does nothing when no CRM is configured,
// and defers the actual provider calls to the outbox.

import { after } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { enqueue, enqueueOnce, flushOutbox } from './outbox'
import { isCrmEnabled } from './registry'

export { isCrmEnabled, isEmailEnabled } from './registry'

/** Drain a few due jobs once the response has been sent. */
export function scheduleFlush(limit = 10): void {
  try {
    after(async () => {
      await flushOutbox(supabaseAdmin(), limit).catch((e) => console.error('[crm] flush failed:', e))
    })
  } catch {
    // Not inside a request (script / test): the cron endpoint will drain it.
  }
}

async function safely(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    console.error(`[crm] ${label} failed:`, err instanceof Error ? err.message : err)
  }
}

/** Sync one person to the CRM (collapses repeats while a job is pending). */
export async function crmSyncUser(userId: string): Promise<void> {
  if (!isCrmEnabled()) return
  await safely('crmSyncUser', async () => {
    await enqueue(supabaseAdmin(), { kind: 'contact', userId, dedupeKey: `contact:${userId}` })
    scheduleFlush()
  })
}

/** Sync everyone in a workspace (plan, usage and members changed). */
export async function crmSyncAccount(accountId: string): Promise<void> {
  if (!isCrmEnabled()) return
  await safely('crmSyncAccount', async () => {
    const db = supabaseAdmin()
    const { data } = await db.from('profiles').select('user_id').eq('account_id', accountId)
    for (const row of (data ?? []) as Array<{ user_id: string }>) {
      await enqueue(db, { kind: 'contact', userId: row.user_id, dedupeKey: `contact:${row.user_id}` })
    }
    scheduleFlush(20)
  })
}

/**
 * Record a lifecycle event for a person (or, with `accountId`, the workspace
 * owner). The contact is synced first so the event lands on a current profile.
 */
export async function crmTrack(
  name: string,
  target: {
    userId?: string | null
    accountId?: string | null
    properties?: Record<string, string | number | boolean>
    /** Track at most once per key, ever (until old jobs are purged): "once per month" notices. */
    onceKey?: string
  },
): Promise<boolean> {
  if (!isCrmEnabled()) return false
  let queued = false
  await safely(`crmTrack(${name})`, async () => {
    const db = supabaseAdmin()
    let userId = target.userId ?? null
    if (!userId && target.accountId) {
      const { data } = await db.from('accounts').select('owner_user_id').eq('id', target.accountId).maybeSingle()
      userId = (data?.owner_user_id as string | null) ?? null
    }
    if (!userId) return
    const event = {
      kind: 'event' as const,
      userId,
      accountId: target.accountId ?? null,
      payload: { name, at: new Date().toISOString(), ...(target.properties ? { properties: target.properties } : {}) },
    }
    // Claim the once-key first so a repeat does not even re-sync the contact.
    queued = target.onceKey ? await enqueueOnce(db, { ...event, dedupeKey: target.onceKey }) : await enqueue(db, event)
    if (!queued) return
    await enqueue(db, { kind: 'contact', userId, dedupeKey: `contact:${userId}` })
    scheduleFlush()
  })
  return queued
}
