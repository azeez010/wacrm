import { describe, expect, it } from 'vitest'
import { parseAnnouncements, pickText, readDismissed, visibleAnnouncements, writeDismissed } from './index'

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
})
