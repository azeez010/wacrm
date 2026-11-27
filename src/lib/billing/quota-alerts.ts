import type { SupabaseClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { crmTrack, isCrmEnabled, isEmailEnabled } from '@/lib/crm'
import { queueQuotaEmail } from '@/lib/email/queue'
import { getLimit } from './entitlements'
import { countBillableMessages } from './usage'

/**
 * Warn at 80% and 100% of the monthly message allowance, once each per month:
 * a CRM event (`quota_80` / `quota_100`) for targeting, and an email to the
 * workspace owner. Safe to call after every billable send: it exits early when
 * nothing is configured or the plan is unlimited. A jump straight past 80% only
 * announces 100%.
 */
export async function checkQuotaThresholds(
  db: SupabaseClient,
  accountId: string,
  now: Date = new Date(),
): Promise<'quota_100' | 'quota_80' | null> {
  if (!(await isCrmEnabled()) && !(await isEmailEnabled())) return null
  const { limit } = await getLimit(db, accountId, 'messages_per_month')
  if (!limit) return null
  const used = await countBillableMessages(db, accountId, now)
  const percent = (used / limit) * 100
  const level: 80 | 100 | null = percent >= 100 ? 100 : percent >= 80 ? 80 : null
  if (!level) return null

  const month = now.toISOString().slice(0, 7)
  const event = level === 100 ? 'quota_100' : 'quota_80'
  const properties = { used, limit, percent: Math.round(percent) }
  const tracked = await crmTrack(event, { accountId, properties, onceKey: `once:${event}:${accountId}:${month}` })
  const emailed = await queueQuotaEmail(db, accountId, level, month, used, limit).catch(() => false)
  return tracked || emailed ? event : null
}

/** Check after the response is sent (never slows or fails the send). */
export function scheduleQuotaCheck(accountId: string): void {
  try {
    after(async () => {
      await checkQuotaThresholds(supabaseAdmin(), accountId).catch((e) =>
        console.error('[quota] threshold check failed:', e instanceof Error ? e.message : e),
      )
    })
  } catch {
    // Not inside a request.
  }
}
