import type { SupabaseClient } from '@supabase/supabase-js'
import { OFFLINE_AFTER_MS } from '@/lib/presence'

// ============================================================
// "Online" badge for the live-chat widget: the visitor sees Online when we are
// inside business hours (if the widget has any) AND someone can answer: an AI
// agent that auto-replies, or a teammate whose dashboard heartbeat is fresh.
// ============================================================

export interface ChatHours {
  enabled?: boolean
  days?: number[]
  from?: string
  to?: string
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Whether `now` falls inside the widget's business hours, in `timezone`. No hours configured = always. Pure. */
export function isWithinHours(hours: ChatHours | undefined | null, timezone: string, now: Date): boolean {
  if (!hours || !hours.enabled) return true
  let weekday: number
  let minutes: number
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
    minutes = Number(get('hour')) * 60 + Number(get('minute'))
  } catch {
    return true // unknown timezone: do not lock the widget closed
  }
  if (weekday < 0) return true
  const days = hours.days ?? [1, 2, 3, 4, 5]
  if (!days.includes(weekday)) return false
  const from = toMinutes(hours.from ?? '09:00')
  const to = toMinutes(hours.to ?? '17:00')
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to // overnight window
}

export interface ChatAvailability {
  aiActive: boolean
  humansOnline: number
}

/** Pure: the widget's "Online" decision. */
export function computeOnline(withinHours: boolean, a: ChatAvailability): boolean {
  return withinHours && (a.aiActive || a.humansOnline > 0)
}

/** Who can answer right now, from the DB (service-role client). */
export async function loadChatAvailability(
  db: SupabaseClient,
  accountId: string,
  now: number = Date.now(),
): Promise<ChatAvailability> {
  const since = new Date(now - OFFLINE_AFTER_MS).toISOString()
  const [ai, presence] = await Promise.all([
    db.from('ai_configs').select('is_active, auto_reply_enabled').eq('account_id', accountId).maybeSingle(),
    db
      .from('member_presence')
      .select('user_id')
      .eq('account_id', accountId)
      .eq('status', 'online')
      .gte('last_seen_at', since),
  ])
  const cfg = ai.data as { is_active?: boolean; auto_reply_enabled?: boolean } | null
  const aiActive = !!cfg && cfg.is_active === true && cfg.auto_reply_enabled === true

  let humansOnline = 0
  const ids = ((presence.data as { user_id: string }[] | null) ?? []).map((r) => r.user_id)
  if (ids.length > 0) {
    // Only teammates who can actually reply (agent and above), not viewers.
    const { data: roles } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .in('user_id', ids)
      .in('account_role', ['owner', 'admin', 'agent'])
    humansOnline = (roles ?? []).length
  }
  return { aiActive, humansOnline }
}
