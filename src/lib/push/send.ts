import type { SupabaseClient } from '@supabase/supabase-js'
import { sendWebPush } from './webpush'

// Fan a notification out to the devices that opted in to background push.
// Best effort: never throws into the caller (a webhook or a trigger).

export type PushPayload = { title: string; body?: string; url?: string; tag?: string }

/** Pushes per device per minute; a flood stops here instead of reaching the phone. */
export const PUSH_RATE_PER_MINUTE = 30

export function vapidConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  if (process.env.WEB_PUSH === 'off') return null
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return null
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT || 'mailto:support@ogadesk.com' }
}

type SubRow = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  window_started_at: string | null
  window_count: number
}

/** True when this send fits in the per-minute budget; returns the next window state. */
export function withinRate(
  row: Pick<SubRow, 'window_started_at' | 'window_count'>,
  now: number,
): { allowed: boolean; started: number; count: number } {
  const started = row.window_started_at ? Date.parse(row.window_started_at) : 0
  if (!started || now - started >= 60_000) return { allowed: true, started: now, count: 1 }
  if (row.window_count >= PUSH_RATE_PER_MINUTE) return { allowed: false, started, count: row.window_count }
  return { allowed: true, started, count: row.window_count + 1 }
}

/**
 * Push to every subscribed device of the given users, or of the whole account
 * when `userIds` is null. Returns how many devices accepted the push.
 */
export async function sendPush(
  db: SupabaseClient,
  target: { accountId: string; userIds: string[] | null },
  payload: PushPayload,
  opts: { urgency?: 'normal' | 'high'; now?: number } = {},
): Promise<{ sent: number; devices: number }> {
  const vapid = vapidConfig()
  if (!vapid) return { sent: 0, devices: 0 }
  try {
    let q = db
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth, window_started_at, window_count')
      .eq('account_id', target.accountId)
    if (target.userIds) {
      if (target.userIds.length === 0) return { sent: 0, devices: 0 }
      q = q.in('user_id', target.userIds)
    }
    const { data } = await q
    const rows = (data ?? []) as SubRow[]
    const body = JSON.stringify(payload)
    const now = opts.now ?? Date.now()
    let sent = 0
    await Promise.all(
      rows.map(async (row) => {
        const rate = withinRate(row, now)
        if (!rate.allowed) return
        const res = await sendWebPush(row, body, vapid, {
          urgency: opts.urgency ?? 'normal',
          topic: payload.tag ? payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined : undefined,
        })
        if (res.ok) {
          sent++
          await db
            .from('push_subscriptions')
            .update({ last_success_at: new Date(now).toISOString(), window_started_at: new Date(rate.started).toISOString(), window_count: rate.count })
            .eq('id', row.id)
        } else if (res.gone) {
          await db.from('push_subscriptions').delete().eq('id', row.id)
        }
      }),
    )
    return { sent, devices: rows.length }
  } catch (err) {
    console.error('[push] send failed:', err)
    return { sent: 0, devices: 0 }
  }
}
