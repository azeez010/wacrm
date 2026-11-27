import type { SupabaseClient } from '@supabase/supabase-js'

import { metaValue } from '@/lib/platform-config'
import { GoogleAuthError, refreshAccessToken } from '@/lib/integrations/google-oauth'

// Google Calendar tools for the AI (the business connected its own calendar with "Connect with Google"):
//   check_availability (read)  free slots inside the business's working hours, from Google free/busy
//   create_event       (action) book a slot (re-checked against free/busy first, so no double booking)
// Times are wall-clock times in the calendar's time zone (config.timezone); conversion uses Intl, which Workers have.

export const CALENDAR_TOOLS = [
  {
    name: 'check_availability',
    title: 'Check free times',
    kind: 'read' as const,
    description: 'List free appointment times in the business calendar for a date (and optionally the following days). Use before offering times to the customer.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'First day to check, YYYY-MM-DD.' },
        days: { type: 'integer', description: 'How many days to check from that date (1-7). Default 1.' },
      },
      required: ['date'],
    },
  },
  {
    name: 'create_event',
    title: 'Book an appointment',
    kind: 'action' as const,
    description: 'Book an appointment in the business calendar at a free time the customer agreed to.',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'Start, local time in the business time zone: YYYY-MM-DDTHH:mm.' },
        duration_minutes: { type: 'integer', description: 'Length in minutes. Default: the configured slot length.' },
        title: { type: 'string', description: 'Short title, e.g. "Consultation with Ada".' },
        customer_name: { type: 'string' },
        customer_email: { type: 'string', description: 'Optional; the customer gets a calendar invitation.' },
        notes: { type: 'string', description: 'Anything the team should know.' },
      },
      required: ['start', 'title'],
    },
  },
]

export interface CalendarConfig {
  calendar_id?: string
  timezone?: string
  slot_minutes?: number
  day_start?: string
  day_end?: string
  /** 0 = Sunday … 6 = Saturday */
  work_days?: number[]
}

export const CALENDAR_DEFAULTS: Required<CalendarConfig> = {
  calendar_id: 'primary', timezone: 'Africa/Lagos', slot_minutes: 30, day_start: '09:00', day_end: '17:00', work_days: [1, 2, 3, 4, 5],
}

export function calendarConfig(raw: Record<string, unknown>): Required<CalendarConfig> {
  const c = { ...CALENDAR_DEFAULTS, ...(raw as CalendarConfig) }
  const tzOk = (() => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: c.timezone })
      return true
    } catch {
      return false
    }
  })()
  return {
    calendar_id: c.calendar_id || 'primary',
    timezone: tzOk ? c.timezone : CALENDAR_DEFAULTS.timezone,
    slot_minutes: Math.min(240, Math.max(10, Math.floor(Number(c.slot_minutes) || 30))),
    day_start: /^\d{2}:\d{2}$/.test(c.day_start) ? c.day_start : CALENDAR_DEFAULTS.day_start,
    day_end: /^\d{2}:\d{2}$/.test(c.day_end) ? c.day_end : CALENDAR_DEFAULTS.day_end,
    work_days: Array.isArray(c.work_days) ? c.work_days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : CALENDAR_DEFAULTS.work_days,
  }
}

// ---------------------------------------------------------------- time zones

function parts(utcMs: number, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs))
      .map((x) => [x.type, x.value]),
  )
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second }
}

/** Minutes the zone is ahead of UTC at that instant. */
export function offsetMinutes(tz: string, utcMs: number): number {
  const p = parts(utcMs, tz)
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(utcMs / 1000) * 1000) / 60_000)
}

/** Wall-clock date + time in `tz` → UTC milliseconds. */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  const off = offsetMinutes(tz, guess)
  let utc = guess - off * 60_000
  const off2 = offsetMinutes(tz, utc)
  if (off2 !== off) utc = guess - off2 * 60_000
  return utc
}

const pad = (n: number) => String(n).padStart(2, '0')
export function formatLocal(utcMs: number, tz: string): { date: string; time: string } {
  const p = parts(utcMs, tz)
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` }
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}
const weekday = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

type Busy = { start: number; end: number }

/** Free slots per working day, skipping anything busy or already past (plus 30 min notice). */
export function freeSlots(cfg: Required<CalendarConfig>, from: string, days: number, busy: Busy[], nowMs: number): { date: string; times: string[] }[] {
  const out: { date: string; times: string[] }[] = []
  const step = cfg.slot_minutes * 60_000
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i)
    if (!cfg.work_days.includes(weekday(date))) continue
    const start = zonedToUtc(date, cfg.day_start, cfg.timezone)
    const end = zonedToUtc(date, cfg.day_end, cfg.timezone)
    const times: string[] = []
    for (let t = start; t + step <= end; t += step) {
      if (t < nowMs + 30 * 60_000) continue
      if (busy.some((b) => t < b.end && t + step > b.start)) continue
      times.push(formatLocal(t, cfg.timezone).time)
    }
    out.push({ date, times })
  }
  return out
}

// ---------------------------------------------------------------- Google API

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

async function accessToken(db: SupabaseClient, integrationId: string, refreshToken: string | undefined, f: typeof fetch, nowMs: number): Promise<string> {
  const hit = tokenCache.get(integrationId)
  if (hit && hit.expiresAt > nowMs + 60_000) return hit.token
  if (!refreshToken) throw new GoogleAuthError('Google Calendar needs to be connected again.', 'invalid_grant')
  const [clientId, clientSecret] = await Promise.all([metaValue('GOOGLE_OAUTH_CLIENT_ID', db), metaValue('GOOGLE_OAUTH_CLIENT_SECRET', db)])
  if (!clientId || !clientSecret) throw new GoogleAuthError('Google sign-in is not set up on this platform yet.')
  try {
    const t = await refreshAccessToken({ refreshToken, clientId, clientSecret }, f)
    tokenCache.set(integrationId, { token: t.accessToken, expiresAt: nowMs + t.expiresIn * 1000 })
    return t.accessToken
  } catch (e) {
    if (e instanceof GoogleAuthError && e.code === 'invalid_grant') {
      await db.from('integrations').update({ status: 'needs_reauth', last_error: 'Google access was revoked or expired. Connect again.', last_error_at: new Date(nowMs).toISOString() }).eq('id', integrationId)
    }
    throw e
  }
}

async function gcal(token: string, path: string, init: RequestInit, f: typeof fetch) {
  const res = await f(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const msg = (j.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`
    throw new Error(`Google Calendar: ${msg}`)
  }
  return j
}

async function busyBetween(token: string, cfg: Required<CalendarConfig>, from: number, to: number, f: typeof fetch): Promise<Busy[]> {
  const j = await gcal(token, '/freeBusy', { method: 'POST', body: JSON.stringify({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items: [{ id: cfg.calendar_id }] }) }, f)
  const cal = (j.calendars as Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> | undefined)?.[cfg.calendar_id]
  if (cal?.errors?.length) throw new Error('Google Calendar: the calendar could not be read. Check the calendar id.')
  return (cal?.busy ?? []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }))
}

export async function runCalendarTool(
  db: SupabaseClient,
  integration: { id: string; config?: Record<string, unknown> },
  secrets: Record<string, string>,
  tool: string,
  args: Record<string, unknown>,
  f: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<{ text: string; isError: boolean }> {
  const cfg = calendarConfig(integration.config ?? {})
  const nowMs = now()
  try {
    const token = await accessToken(db, integration.id, secrets.refresh_token, f, nowMs)

    if (tool === 'check_availability') {
      const date = String(args.date ?? '')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { text: 'date must be YYYY-MM-DD.', isError: true }
      const days = Math.min(7, Math.max(1, Math.floor(Number(args.days) || 1)))
      const from = zonedToUtc(date, '00:00', cfg.timezone)
      const to = zonedToUtc(addDays(date, days), '00:00', cfg.timezone)
      const busy = await busyBetween(token, cfg, from, to, f)
      const slots = freeSlots(cfg, date, days, busy, nowMs)
      if (slots.length === 0) return { text: `No working days in that range (open ${cfg.work_days.map((d) => WEEKDAY[d]).join(', ')}).`, isError: false }
      const lines = slots.map((s) => `${s.date} (${WEEKDAY[weekday(s.date)]}): ${s.times.length ? s.times.slice(0, 24).join(', ') : 'fully booked'}`)
      return { text: `Free ${cfg.slot_minutes}-minute slots, times in ${cfg.timezone}:\n${lines.join('\n')}`, isError: false }
    }

    if (tool === 'create_event') {
      const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(args.start ?? ''))
      if (!m) return { text: 'start must be YYYY-MM-DDTHH:mm in the business time zone.', isError: true }
      const title = String(args.title ?? '').trim().slice(0, 200)
      if (!title) return { text: 'A title is required.', isError: true }
      const minutes = Math.min(480, Math.max(5, Math.floor(Number(args.duration_minutes) || cfg.slot_minutes)))
      const start = zonedToUtc(m[1], m[2], cfg.timezone)
      const end = start + minutes * 60_000
      if (start < nowMs) return { text: 'That time is in the past.', isError: true }
      const busy = await busyBetween(token, cfg, start, end, f)
      if (busy.some((b) => start < b.end && end > b.start)) return { text: 'That time is no longer free. Check availability again and offer another time.', isError: true }

      const email = typeof args.customer_email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.customer_email) ? args.customer_email : null
      const description = [
        args.customer_name ? `Customer: ${String(args.customer_name).slice(0, 120)}` : null,
        email ? `Email: ${email}` : null,
        args.notes ? `Notes: ${String(args.notes).slice(0, 1000)}` : null,
        'Booked by the OgaDesk AI assistant.',
      ].filter(Boolean).join('\n')
      const ev = await gcal(token, `/calendars/${encodeURIComponent(cfg.calendar_id)}/events?sendUpdates=${email ? 'all' : 'none'}`, {
        method: 'POST',
        body: JSON.stringify({
          summary: title,
          description,
          start: { dateTime: new Date(start).toISOString(), timeZone: cfg.timezone },
          end: { dateTime: new Date(end).toISOString(), timeZone: cfg.timezone },
          ...(email ? { attendees: [{ email }] } : {}),
        }),
      }, f)
      const local = formatLocal(start, cfg.timezone)
      return { text: `Booked "${title}" on ${local.date} at ${local.time} (${cfg.timezone}) for ${minutes} minutes.${email ? ` An invitation was sent to ${email}.` : ''}${ev.htmlLink ? `\nEvent: ${String(ev.htmlLink)}` : ''}`, isError: false }
    }

    return { text: `Unknown calendar tool ${tool}.`, isError: true }
  } catch (e) {
    return { text: e instanceof Error ? e.message : 'Google Calendar failed.', isError: true }
  }
}
