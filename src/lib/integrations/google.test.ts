import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/platform-config', () => ({ metaValue: async (k: string) => (k === 'GOOGLE_OAUTH_CLIENT_ID' ? 'cid' : 'csecret') }))
import { authUrl, exchangeCode, signState, verifyState } from './google-oauth'
import { calendarConfig, freeSlots, runCalendarTool, zonedToUtc, formatLocal } from '@/lib/ai/tools/executors/google-calendar'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const db = { from: () => ({ update: () => ({ eq: async () => ({}) }) }) } as unknown as SupabaseClient

describe('OAuth state', () => {
  it('round-trips, and rejects tampering, a wrong secret and expiry', async () => {
    const t = await signState({ aid: 'a', uid: 'u' }, 'secret', 1000)
    expect(await verifyState(t, 'secret', 1100)).toMatchObject({ aid: 'a', uid: 'u' })
    expect(await verifyState(t, 'other', 1100)).toBeNull()
    expect(await verifyState(t, 'secret', 1000 + 601)).toBeNull()
    const [b, s] = t.split('.')
    expect(await verifyState(`${b}x.${s}`, 'secret', 1100)).toBeNull()
    expect(await verifyState('garbage', 'secret')).toBeNull()
  })
  it('builds a consent URL with offline access and narrow scopes', () => {
    const u = new URL(authUrl('cid', 'https://x/cb', 'st'))
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('scope')).toContain('calendar.events')
    expect(u.searchParams.get('scope')).not.toContain('auth/calendar ')
  })
  it('requires a refresh token and reads the email', async () => {
    const idt = `h.${btoa(JSON.stringify({ email: 'a@b.com' }))}.s`
    const ok = vi.fn(async () => json(200, { refresh_token: 'r', access_token: 'a', expires_in: 3600, id_token: idt, scope: 'x' })) as unknown as typeof fetch
    expect(await exchangeCode({ code: 'c', clientId: 'i', clientSecret: 's', redirectUri: 'u' }, ok)).toMatchObject({ refreshToken: 'r', email: 'a@b.com' })
    const none = vi.fn(async () => json(200, { access_token: 'a' })) as unknown as typeof fetch
    await expect(exchangeCode({ code: 'c', clientId: 'i', clientSecret: 's', redirectUri: 'u' }, none)).rejects.toThrow(/refresh token/)
  })
})

describe('time zones and slots', () => {
  it('converts wall-clock time in Lagos (UTC+1) and New York (DST)', () => {
    expect(new Date(zonedToUtc('2026-12-01', '09:00', 'Africa/Lagos')).toISOString()).toBe('2026-12-01T08:00:00.000Z')
    expect(new Date(zonedToUtc('2026-07-01', '09:00', 'America/New_York')).toISOString()).toBe('2026-07-01T13:00:00.000Z')
    expect(formatLocal(Date.parse('2026-12-01T08:30:00Z'), 'Africa/Lagos')).toEqual({ date: '2026-12-01', time: '09:30' })
  })
  it('skips busy periods, weekends and the past', () => {
    const cfg = calendarConfig({ timezone: 'Africa/Lagos', slot_minutes: 60, day_start: '09:00', day_end: '12:00' })
    const busy = [{ start: Date.parse('2026-12-01T09:30:00Z'), end: Date.parse('2026-12-01T10:30:00Z') }] // 10:30-11:30 Lagos
    const out = freeSlots(cfg, '2026-12-04', 3, busy, 0) // Fri, Sat, Sun
    expect(out.map((d) => d.date)).toEqual(['2026-12-04'])
    const tue = freeSlots(cfg, '2026-12-01', 1, busy, 0)[0]
    expect(tue.times).toEqual(['09:00']) // 10:00 and 11:00 overlap the busy block
    expect(freeSlots(cfg, '2026-12-01', 1, [], Date.parse('2026-12-01T08:45:00Z'))[0].times).toEqual(['11:00'])
  })
})

describe('runCalendarTool', () => {
  const integ = { id: 'i1', config: { timezone: 'Africa/Lagos', slot_minutes: 30, day_start: '09:00', day_end: '11:00' } }
  const now = () => Date.parse('2026-12-01T06:00:00Z')
  const mk = (busy: unknown[]) => vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('oauth2.googleapis.com')) return json(200, { access_token: 'tok', expires_in: 3600 })
    if (url.endsWith('/freeBusy')) return json(200, { calendars: { primary: { busy } } })
    if (url.includes('/events')) return json(200, { htmlLink: 'https://cal/e1', _body: init?.body })
    return json(404, {})
  })

  it('lists free slots', async () => {
    const f = mk([{ start: '2026-12-01T08:00:00Z', end: '2026-12-01T08:30:00Z' }])
    const r = await runCalendarTool(db, { ...integ, id: 'a' }, { refresh_token: 'r' }, 'check_availability', { date: '2026-12-01' }, f as unknown as typeof fetch, now)
    expect(r.isError).toBe(false)
    expect(r.text).toContain('2026-12-01 (Tue): 09:30, 10:00, 10:30')
  })
  it('books a free time, refuses a taken one and the past', async () => {
    const ok = mk([])
    const r = await runCalendarTool(db, { ...integ, id: 'b' }, { refresh_token: 'r' }, 'create_event', { start: '2026-12-01T10:00', title: 'Ada', customer_email: 'ada@x.com' }, ok as unknown as typeof fetch, now)
    expect(r.text).toContain('Booked "Ada" on 2026-12-01 at 10:00')
    expect(r.text).toContain('invitation')
    const taken = mk([{ start: '2026-12-01T09:00:00Z', end: '2026-12-01T09:30:00Z' }])
    expect((await runCalendarTool(db, { ...integ, id: 'c' }, { refresh_token: 'r' }, 'create_event', { start: '2026-12-01T10:00', title: 'Ada' }, taken as unknown as typeof fetch, now)).text).toMatch(/no longer free/)
    expect((await runCalendarTool(db, { ...integ, id: 'd' }, { refresh_token: 'r' }, 'create_event', { start: '2026-11-01T10:00', title: 'Ada' }, ok as unknown as typeof fetch, now)).text).toMatch(/past/)
  })
  it('asks to reconnect when the refresh token is gone', async () => {
    const r = await runCalendarTool(db, { ...integ, id: 'e' }, {}, 'check_availability', { date: '2026-12-01' }, vi.fn() as unknown as typeof fetch, now)
    expect(r).toMatchObject({ isError: true })
    expect(r.text).toMatch(/connected again/)
  })
})
