import { describe, expect, it } from 'vitest'
import { coerceValue, normalizeEmail, normalizePhoneValue, normalizeUrl } from './coerce'
import { formatFieldValue } from './format'
import { fromLocalInput, toLocalInput } from './datetime-tz'
import type { FieldDef } from './types'

const f = (t: FieldDef['field_type']): FieldDef => ({ id: 'f', key: 'k', field_name: 'F', field_type: t })

describe('url / email / phone', () => {
  it('normalises urls and rejects non-web or hostless ones', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/')
    expect(normalizeUrl('http://a.io/x?y=1')).toBe('http://a.io/x?y=1')
    expect(normalizeUrl('ftp://a.io')).toBeNull()
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('nodots')).toBeNull()
    expect(normalizeUrl('has space.com')).toBeNull()
  })
  it('lower-cases and validates emails', () => {
    expect(normalizeEmail(' Ada@Example.COM ')).toBe('ada@example.com')
    expect(normalizeEmail('nope')).toBeNull()
    expect(normalizeEmail('a@b')).toBeNull()
  })
  it('stores phones as +digits and requires the country code', () => {
    expect(normalizePhoneValue('+234 (801) 234-5678')).toBe('+2348012345678')
    expect(normalizePhoneValue('08012345678')).toBeNull()
  })
  it('coerceValue wires them in', () => {
    expect(coerceValue(f('url'), 'example.com')).toMatchObject({ ok: true, value: { value: 'https://example.com/' } })
    expect(coerceValue(f('email'), 'x')).toMatchObject({ ok: false })
    expect(coerceValue(f('phone'), '+14155550123')).toMatchObject({ ok: true, value: { value: '+14155550123' } })
  })
})

describe('datetime', () => {
  it('keeps the time and treats a bare value as UTC', () => {
    expect(coerceValue(f('datetime'), '2026-11-02T15:30:00Z')).toMatchObject({
      ok: true,
      value: { value_date: '2026-11-02T15:30:00.000Z' },
    })
    expect(coerceValue(f('datetime'), '2026-11-02T15:30')).toMatchObject({
      value: { value_date: '2026-11-02T15:30:00.000Z' },
    })
    expect(coerceValue(f('datetime'), '2026-11-02T15:30:00+01:00')).toMatchObject({
      value: { value_date: '2026-11-02T14:30:00.000Z' },
    })
    expect(coerceValue(f('datetime'), 'soon')).toMatchObject({ ok: false })
  })
  it('converts between instants and account-zone clock text', () => {
    // Lagos is UTC+1 all year
    expect(toLocalInput('2026-11-02T14:30:00.000Z', 'Africa/Lagos')).toBe('2026-11-02T15:30')
    expect(fromLocalInput('2026-11-02T15:30', 'Africa/Lagos')).toBe('2026-11-02T14:30:00.000Z')
    // New York in winter is UTC-5, in summer UTC-4
    expect(fromLocalInput('2026-01-15T09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z')
    expect(fromLocalInput('2026-07-15T09:00', 'America/New_York')).toBe('2026-07-15T13:00:00.000Z')
    expect(toLocalInput('', 'UTC')).toBe('')
    expect(fromLocalInput('garbage', 'UTC')).toBe('')
  })
  it('formats datetimes in a zone and shortens urls', () => {
    expect(formatFieldValue({ field_type: 'datetime' }, '2026-11-02T14:30:00.000Z', { locale: 'en-US', timeZone: 'Africa/Lagos' })).toContain('3:30')
    expect(formatFieldValue({ field_type: 'url' }, 'https://example.com/')).toBe('example.com')
  })
})
