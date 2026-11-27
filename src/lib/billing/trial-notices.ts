import type { SupabaseClient } from '@supabase/supabase-js'

import { crmTrack } from '@/lib/crm'
import { queueTrialEmail } from '@/lib/email/queue'

// What happens around the end of a free trial. The daily-ish sweep (POST /api/billing/sweep) calls this:
//   * trials ending within `reminderDays` -> email + in-app notification + CRM event, once (stamped by trial_reminded)
//   * trials that just ended (payment_sweep already put them back on Free) -> email + in-app notification
// Every step is best effort: a failed email must never stop the sweep or the next account.

type Ended = { accountId: string; planId: string }
type Ending = { accountId: string; planId: string; endsAt: string }

const DAY_MS = 86_400_000

async function planNames(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const { data } = await db.from('plans').select('id, name').in('id', [...new Set(ids)])
  return new Map(((data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]))
}

/** The owner and admins of the workspace see the in-app notification. */
async function notify(db: SupabaseClient, accountId: string, type: 'trial_ending' | 'trial_ended', title: string, body: string) {
  const { data } = await db.from('account_members').select('user_id').eq('account_id', accountId).in('account_role', ['owner', 'admin'])
  const rows = ((data ?? []) as { user_id: string }[]).map((m) => ({ account_id: accountId, user_id: m.user_id, type, title, body }))
  if (rows.length > 0) await db.from('notifications').insert(rows)
}

export interface TrialSweepResult {
  reminded: number
  ended: number
}

export async function runTrialNotices(db: SupabaseClient, ended: Ended[], reminderDays: number, now: number = Date.now()): Promise<TrialSweepResult> {
  const out: TrialSweepResult = { reminded: 0, ended: 0 }

  const { data: endingData } = await db.rpc('trials_ending', { p_days: reminderDays })
  const ending = (endingData as Ending[] | null) ?? []
  const names = await planNames(db, [...ending.map((e) => e.planId), ...ended.map((e) => e.planId)])

  for (const e of ending) {
    try {
      const plan = names.get(e.planId) ?? e.planId
      const days = Math.max(1, Math.ceil((new Date(e.endsAt).getTime() - now) / DAY_MS))
      await queueTrialEmail(db, e.accountId, 'trial_ending', plan, e.endsAt, days)
      await notify(db, e.accountId, 'trial_ending', `Your ${plan} trial ends in ${days} ${days === 1 ? 'day' : 'days'}`, 'Choose a plan to keep your features and limits.')
      await crmTrack('trial_ending', { accountId: e.accountId, properties: { plan: e.planId, days_left: days }, onceKey: `trial_ending:${e.accountId}:${e.endsAt}` })
      await db.rpc('trial_reminded', { p_account: e.accountId })
      out.reminded += 1
    } catch (err) {
      console.error('[trial] reminder failed:', err instanceof Error ? err.message : err)
    }
  }

  for (const e of ended) {
    try {
      const plan = names.get(e.planId) ?? e.planId
      await queueTrialEmail(db, e.accountId, 'trial_ended', plan, new Date(now).toISOString().slice(0, 10))
      await notify(db, e.accountId, 'trial_ended', `Your ${plan} trial has ended`, "You're back on the Free plan. Choose a plan to get your features back.")
      await crmTrack('trial_ended', { accountId: e.accountId, properties: { plan: e.planId }, onceKey: `trial_ended:${e.accountId}:${new Date(now).toISOString().slice(0, 10)}` })
      out.ended += 1
    } catch (err) {
      console.error('[trial] ended notice failed:', err instanceof Error ? err.message : err)
    }
  }
  return out
}
