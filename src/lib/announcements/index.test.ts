import { describe, expect, it } from 'vitest'
import { BAR_STYLES, countdownParts, forCountry, parseAnnouncements, pickText, readDismissed, STYLE_CLASS, visibleAnnouncements, writeDismissed } from './index'

describe('announcements', () => {
  it('picks the locale, then the base language, then English', () => {
    const m = { en: 'Hello', fr: 'Bonjour', pt: 'Olá' }
    expect(pickText(m, 'fr')).toBe('Bonjour')
    expect(pickText(m, 'pt-BR')).toBe('Olá')
    expect(pickText(m, 'ko')).toBe('Hello')
    expect(pickText({ fr: 'x' }, 'ko')).toBe('')
    expect(pickText(null, 'en')).toBe('')
  })

  it('parses defensively: drops malformed rows, unsafe links and unknown severities', () => {
    const out = parseAnnouncements([
      { id: 'a', severity: 'warning', title: { en: 'T' }, body: { en: 'B' }, linkUrl: 'javascript:alert(1)', linkLabel: {}, dismissible: false },
      { id: 'b', severity: 'nuclear', title: { en: 'T2' }, linkUrl: '/pricing' },
      { id: 'c', title: { fr: 'no english' } },
      null, 'x', { title: { en: 'no id' } },
    ])
    expect(out.map((a) => a.id)).toEqual(['a', 'b'])
    expect(out[0]).toMatchObject({ severity: 'warning', linkUrl: null, dismissible: false })
    expect(out[1]).toMatchObject({ severity: 'info', linkUrl: '/pricing', dismissible: true, body: {} })
    expect(parseAnnouncements({ data: [] })).toEqual([])
  })

  it('remembers dismissals, survives broken storage, and keeps non-dismissible ones visible', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    writeDismissed(storage, ['a'])
    expect(readDismissed(storage)).toEqual(['a'])
    store.set('ogd-dismissed-announcements', '{not json')
    expect(readDismissed(storage)).toEqual([])
    expect(readDismissed(undefined)).toEqual([])
    writeDismissed({ setItem: () => { throw new Error('quota') } }, ['x'])
    const all = parseAnnouncements([{ id: 'a', title: { en: 'A' } }, { id: 'b', title: { en: 'B' }, dismissible: false }])
    expect(visibleAnnouncements(all, ['a', 'b']).map((a) => a.id)).toEqual(['b'])
  })

  it('parses bar options: style, badge, countdown and countries', () => {
    const [a, b] = parseAnnouncements([
      { id: 'a', title: { en: 'Sale' }, style: 'gradient', badge: { en: 'BLACK FRIDAY' }, countdownTo: '2026-11-30T23:59:00Z', countries: ['NG', 'gh', 7, 'GH'] },
      { id: 'b', title: { en: 'X' }, style: 'neon', countdownTo: 'not a date', countries: 'NG' },
    ])
    expect(a).toMatchObject({ style: 'gradient', badge: { en: 'BLACK FRIDAY' }, countdownTo: '2026-11-30T23:59:00Z', countries: ['NG', 'GH'] })
    expect(b).toMatchObject({ style: 'brand', badge: {}, countdownTo: null, countries: [] })
  })

  it('targets countries: global bars for everyone, listed ones only for their countries', () => {
    const all = parseAnnouncements([{ id: 'g', title: { en: 'G' } }, { id: 'ng', title: { en: 'N' }, countries: ['NG', 'GH'] }])
    expect(forCountry(all, 'NG').map((a) => a.id)).toEqual(['g', 'ng'])
    expect(forCountry(all, 'gh').map((a) => a.id)).toEqual(['g', 'ng'])
    expect(forCountry(all, 'US').map((a) => a.id)).toEqual(['g'])
    expect(forCountry(all, null).map((a) => a.id)).toEqual(['g'])
    expect(forCountry(all, 'XX').map((a) => a.id)).toEqual(['g'])
  })

  it('splits the countdown and stops at zero', () => {
    expect(countdownParts(((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000 + 999)).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5 })
    expect(countdownParts(0)).toBeNull()
    expect(countdownParts(-5)).toBeNull()
    expect(countdownParts(Number.NaN)).toBeNull()
  })

  it('has colours for every bar style', () => {
    for (const s of BAR_STYLES) expect(STYLE_CLASS[s].bar).toBeTruthy()
  })
})
