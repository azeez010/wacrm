import { describe, expect, it } from 'vitest'
import { normalizeFormPhone, callingCode } from './countries'
import { scoreAnswers } from './scoring'
import { validateAnswers, type FormCustomField } from './validate-answers'
import {
  formSettingsSchema,
  parseFormFields,
  parseFormSettings,
  submitPayloadSchema,
  type FormField,
} from './types'
import { firstTouchPatch, utmToColumns } from '@/lib/contacts/lead-source'
import type { FieldDef } from '@/lib/custom-fields/types'

describe('normalizeFormPhone', () => {
  it('handles the shapes people actually type', () => {
    expect(normalizeFormPhone('+234 803 123 4567')).toBe('+2348031234567')
    expect(normalizeFormPhone('0803 123 4567', 'NG')).toBe('+2348031234567')
    expect(normalizeFormPhone('2348031234567', 'NG')).toBe('+2348031234567')
    expect(normalizeFormPhone('002348031234567')).toBe('+2348031234567')
    expect(normalizeFormPhone('(0803) 123-4567', 'NG')).toBe('+2348031234567')
    expect(normalizeFormPhone('0244123456', 'GH')).toBe('+233244123456')
  })
  it('rejects junk', () => {
    expect(normalizeFormPhone('')).toBeNull()
    expect(normalizeFormPhone('abc')).toBeNull()
    expect(normalizeFormPhone('+12')).toBeNull()
    expect(normalizeFormPhone('+1234567890123456789')).toBeNull()
    expect(normalizeFormPhone(42 as never)).toBeNull()
  })
  it('falls back to Nigeria for an unknown country', () => {
    expect(callingCode('ZZ')).toBe('234')
    expect(callingCode(undefined)).toBe('234')
  })
})

const enumField: FormField = {
  id: 'f_plan',
  kind: 'custom_field',
  label: 'Plan',
  customFieldId: '11111111-1111-4111-8111-111111111111',
  required: true,
  points: { Gold: 10, Silver: 5 },
  disqualify: ['None'],
}
const base = { qualification: { enabled: true, threshold: 8, onUnqualified: 'save' as const } }

describe('scoreAnswers', () => {
  it('sums points, case-insensitively, and applies the threshold', () => {
    expect(scoreAnswers([enumField], { f_plan: 'gold' }, base)).toEqual({ score: 10, disqualified: false, qualified: true })
    expect(scoreAnswers([enumField], { f_plan: 'Silver' }, base)).toEqual({ score: 5, disqualified: false, qualified: false })
  })
  it('a disqualifying option wins over points', () => {
    expect(scoreAnswers([{ ...enumField, points: { None: 50 } }], { f_plan: 'None' }, base)).toMatchObject({ disqualified: true, qualified: false })
  })
  it('everyone qualifies when qualification is off', () => {
    const off = { qualification: { enabled: false, threshold: 99, onUnqualified: 'save' as const } }
    expect(scoreAnswers([enumField], { f_plan: 'Silver' }, off).qualified).toBe(true)
  })
  it('sums multi-select answers', () => {
    const f: FormField = { ...enumField, points: { a: 1, b: 2, c: 4 } }
    expect(scoreAnswers([f], { f_plan: ['a', 'c'] }, base).score).toBe(5)
  })
})

const planDef: FormCustomField = {
  id: '11111111-1111-4111-8111-111111111111',
  key: 'plan',
  field_name: 'Plan',
  field_type: 'enum',
  field_options: { options: ['Gold', 'Silver', 'Bronze'] },
}
const ageDef: FormCustomField = {
  id: '22222222-2222-4222-8222-222222222222',
  key: 'age',
  field_name: 'Age',
  field_type: 'number',
  field_options: { min: 10, max: 100 },
}
const nameCol: FieldDef = { id: 'c1', field_name: 'name', field_type: 'text' } as FieldDef
const REF = '33333333-3333-4333-8333-333333333333'
const TAG_OK = '44444444-4444-4444-8444-444444444444'
const TAG_BAD = '55555555-5555-4555-8555-555555555555'

const ctx = {
  accountId: 'acc',
  defaultCountry: 'NG',
  customFields: new Map<string, FormCustomField>([[planDef.id, planDef], [ageDef.id, ageDef]]),
  tableColumns: new Map<string, FieldDef>([[`${REF}:name`, nameCol]]),
  now: new Date('2026-01-01T00:00:00Z'),
}
const fields: FormField[] = [
  { id: 'phone', kind: 'phone', label: 'WhatsApp' },
  { id: 'name', kind: 'name', label: 'Name', required: true },
  { id: 'email', kind: 'email', label: 'Email' },
  { id: 'msg', kind: 'message', label: 'Message' },
  { id: 'plan', kind: 'custom_field', label: 'Plan', customFieldId: planDef.id, options: ['Gold', 'Silver'] },
  { id: 'age', kind: 'custom_field', label: 'Age', customFieldId: ageDef.id },
  { id: 'gym', kind: 'table_column', label: 'Gym', tableRef: { fieldId: REF, columnKey: 'name' } },
  { id: 'tags', kind: 'tag_picker', label: 'Interest', tagIds: [TAG_OK] },
  { id: 'ok', kind: 'consent', label: 'Agree', required: true, consentText: 'I agree' },
  { id: 'h', kind: 'hidden', label: 'Ad', param: 'ad_id' },
]

describe('validateAnswers', () => {
  const good = {
    phone: '0803 123 4567',
    name: ' Ada ',
    email: 'ADA@Example.com',
    msg: 'Hello',
    plan: 'gold',
    age: '30',
    gym: 'Lekki',
    tags: [TAG_OK, TAG_BAD],
    ok: true,
    h: 'ad-77',
  }

  it('accepts a complete submission and normalises it', () => {
    const r = validateAnswers(fields, good, ctx)
    expect(r.ok).toBe(true)
    expect(r.phone).toBe('+2348031234567')
    expect(r.name).toBe('Ada')
    expect(r.email).toBe('ada@example.com')
    expect(r.customByKey).toEqual({ plan: 'gold', age: '30' })
    expect(r.tableRows).toEqual({ [REF]: { name: 'Lekki' } })
    expect(r.consent).toMatchObject({ text: 'I agree', at: '2026-01-01T00:00:00.000Z' })
    expect(r.snapshot.h).toEqual({ label: 'ad_id', value: 'ad-77' })
  })

  it('only keeps tag ids the form offers', () => {
    expect(validateAnswers(fields, good, ctx).tagIds).toEqual([TAG_OK])
  })

  it('phone is always required, even if the stored flag says otherwise', () => {
    const r = validateAnswers(fields, { ...good, phone: '' }, ctx)
    expect(r.ok).toBe(false)
    expect(r.errors.phone).toBe('required')
  })

  it('reports required, bad email, bad number and choices outside the allowed subset', () => {
    const r = validateAnswers(fields, { ...good, name: '', email: 'nope', age: '5', plan: 'Bronze', ok: false }, ctx)
    expect(r.ok).toBe(false)
    expect(Object.keys(r.errors).sort()).toEqual(['age', 'email', 'name', 'ok', 'plan'])
    expect(r.errors.plan).toBe('invalid_choice')
  })

  it('ignores answers for fields that are not on the form (no mass assignment)', () => {
    const r = validateAnswers(fields, { ...good, blocked_at: 'x', evil: '1', [planDef.id]: 'Gold' }, ctx)
    expect(r.ok).toBe(true)
    expect(JSON.stringify(r)).not.toContain('evil')
  })

  it('does not fail a visitor because the owner deleted a mapped custom field', () => {
    const r = validateAnswers(fields, good, { ...ctx, customFields: new Map() })
    expect(r.ok).toBe(true)
    expect(r.customByKey).toEqual({})
  })

  it('a fixed hidden value wins over what the visitor sends', () => {
    const r = validateAnswers([{ id: 'phone', kind: 'phone' }, { id: 'h', kind: 'hidden', label: 'src', fixedValue: 'qr' }], { phone: '08031234567', h: 'hacked' }, ctx)
    expect(r.snapshot.h.value).toBe('qr')
  })
})

describe('lead source (first touch)', () => {
  const now = new Date('2026-02-02T00:00:00Z')
  it('fills only empty columns and stamps first_seen_at', () => {
    const p = firstTouchPatch({ utm_source: 'google', lead_source: null }, { utm_source: 'facebook', utm_campaign: 'spring', lead_source: 'Form: Gym' }, now)
    expect(p).toEqual({ utm_campaign: 'spring', lead_source: 'Form: Gym', first_seen_at: now.toISOString() })
  })
  it('does nothing when everything is already set', () => {
    expect(firstTouchPatch({ lead_source: 'x', first_seen_at: 'y' }, { lead_source: 'z' }, now)).toEqual({})
  })
  it('a brand-new contact gets everything', () => {
    expect(Object.keys(firstTouchPatch(null, { lead_source: 'API' }, now)).sort()).toEqual(['first_seen_at', 'lead_source'])
  })
  it('maps utm keys onto contact columns and trims/limits input', () => {
    expect(utmToColumns({ source: 'fb', medium: 'cpc' })).toMatchObject({ utm_source: 'fb', utm_medium: 'cpc' })
    expect(firstTouchPatch(null, { lead_source: '  ' }, now)).toEqual({})
  })
})

describe('schemas', () => {
  it('settings default sensibly and reject unknown keys', () => {
    const s = parseFormSettings({})
    expect(s.success.action).toBe('message')
    expect(s.qualification.enabled).toBe(false)
    expect(formSettingsSchema.safeParse({ nope: 1 }).success).toBe(false)
  })
  it('falls back instead of throwing on stored junk', () => {
    expect(parseFormSettings({ accent: 'red' }).success.action).toBe('message')
    expect(parseFormFields('junk')).toEqual([])
  })
  it('caps the number of fields and rejects unknown keys on a field', () => {
    expect(parseFormFields(Array.from({ length: 41 }, (_, i) => ({ id: `f${i}`, kind: 'name' })))).toEqual([])
    expect(parseFormFields([{ id: 'a', kind: 'name', blocked_at: 'x' }])).toEqual([])
  })
  it('the submit payload is strict, with a size-limited answers map', () => {
    expect(submitPayloadSchema.safeParse({ answers: { a: 'x' }, extra: 1 }).success).toBe(false)
    expect(submitPayloadSchema.safeParse({ answers: { a: 'x'.repeat(5001) } }).success).toBe(false)
    expect(submitPayloadSchema.safeParse({}).success).toBe(true)
  })
})
