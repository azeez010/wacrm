import type { SupabaseClient } from '@supabase/supabase-js'
import { getLimit } from './entitlements'

/**
 * The monthly message quota (`messages_per_month`).
 *
 * "Billable" messages are outbound template messages (see migration 073):
 * those are what WhatsApp charges for, whereas free-form replies inside the
 * 24-hour window are free and never consume the allowance. The period is the
 * calendar month in UTC.
 */

export class QuotaExceededError extends Error {
  readonly status = 402 as const
  readonly code = 'quota_exceeded' as const
  constructor(
    readonly limit: number,
    readonly used: number,
    readonly planName: string,
  ) {
    super(
      `Your ${planName} plan includes ${limit.toLocaleString('en-US')} messages per month and ${used.toLocaleString('en-US')} have been used. Upgrade your plan to send more.`,
    )
    this.name = 'QuotaExceededError'
  }
}

export function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export function nextMonthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

/** Billable messages sent so far this month. Needs the service-role client. */
export async function countBillableMessages(
  supabase: SupabaseClient,
  accountId: string,
  now: Date = new Date(),
): Promise<number> {
  const { data, error } = await supabase.rpc('count_billable_messages', {
    p_account: accountId,
    p_since: monthStartUtc(now).toISOString(),
  })
  if (error) {
    // Fail open: a counting hiccup must not stop someone's OTP from sending.
    console.error('[usage] count_billable_messages failed:', error.message)
    return 0
  }
  return Number(data ?? 0)
}

/**
 * Throw `QuotaExceededError` if sending `count` more billable messages would
 * go past the plan's monthly allowance. Unlimited plans (null) never throw.
 * (Concurrent sends can overshoot by a few messages; this is a plan limit, not
 * a billing ledger.)
 */
export async function assertMessageQuota(
  supabase: SupabaseClient,
  accountId: string,
  count = 1,
): Promise<void> {
  const { planName, limit } = await getLimit(supabase, accountId, 'messages_per_month')
  if (limit === null) return
  const used = await countBillableMessages(supabase, accountId)
  if (used + count > limit) throw new QuotaExceededError(limit, used, planName)
}
