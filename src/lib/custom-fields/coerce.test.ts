import { describe, expect, it } from 'vitest'
import { coerceValue, isValidKey, slugifyKey, validateFieldOptions } from './coerce'
import { planTypedValueWrites } from './value-writes'
import type { FieldDef } from './types'

const f = (over: Partial<FieldDef>): FieldDef => ({
  id: 'f1',
  key: 'k',
  field_name: 'Field',
  field_type: 'text',
  ...over,
})

describe('coerceValue', () => {
  it('clears on empty values and errors when required', () => {
    expect(coerceValue(f({}), '  ')).toEqual({ ok: true, clear: true })
    expect(coerceValue(f({}), null)).toEqual({ ok: true, clear: true })
    expect(coerceValue(f({ required: true }), '')).toMatchObject({ ok: false })
  })

  it('trims text and enforces the length cap', () => {
    expect(coerceValue(f({}), '  hi ')).toMatchObject({ ok: true, value: { value: 'hi' } })
    expect(coerceValue(f({}), 'x'.repeat(2001))).toMatchObject({ ok: false })
  })

  it('parses numbers incl. thousands separators and enforces min/max', () => {
    const num = f({ field_type: 'number', field_options: { min: 0, max: 100000 } })
    expect(coerceValue(num, '15,000')).toMatchObject({
      ok: true,
      value: { value: '15000', value_number: 15000 },
    })
    expect(coerceValue(num, 'abc')).toMatchObject({ ok: false })
    expect(coerceValue(num, '-1')).toMatchObject({ ok: false })
    expect(coerceValue(num, 100001)).toMatchObject({ ok: false })
    expect(coerceValue(num, 0)).toMatchObject({ ok: true, value: { value_number: 0 } })
  })

  it('parses booleans', () => {
    const b = f({ field_type: 'bool' })
    expect(coerceValue(b, 'Yes')).toMatchObject({ ok: true, value: { value_bool: true, value: 'true' } })
    expect(coerceValue(b, 'off')).toMatchObject({ ok: true, value: { value_bool: false } })
    expect(coerceValue(b, false)).toMatchObject({ ok: true, value: { value_bool: false } })
    expect(coerceValue(b, 'maybe')).toMatchObject({ ok: false })
  })

  it('parses dates and pins date-only values to UTC midnight', () => {
    const d = f({ field_type: 'date' })
    expect(coerceValue(d, '2026-11-02')).toMatchObject({
      ok: true,
      value: { value_date: '2026-11-02T00:00:00.000Z' },
    })
    expect(coerceValue(d, '2026-02-30')).toMatchObject({ ok: false })
    expect(coerceValue(d, 'tomorrow')).toMatchObject({ ok: false })
    expect(coerceValue(d, '2026-11-02T15:30:00Z')).toMatchObject({
      value: { value_date: '2026-11-02T00:00:00.000Z' },
    })
    const dt = f({ field_type: 'date', field_options: { include_time: true } })
    expect(coerceValue(dt, '2026-11-02T15:30:00Z')).toMatchObject({
      value: { value_date: '2026-11-02T15:30:00.000Z' },
    })
  })

  it('matches enum options case-insensitively and rejects others', () => {
    const e = f({ field_type: 'enum', field_options: { options: ['Gold', 'Silver'] } })
    expect(coerceValue(e, 'gold')).toMatchObject({ ok: true, value: { value: 'Gold' } })
    expect(coerceValue(e, 'Bronze')).toMatchObject({ ok: false })
  })

  it('handles multi_enum from arrays, csv and JSON, de-duplicating', () => {
    const m = f({ field_type: 'multi_enum', field_options: { options: ['Yoga', 'Boxing', 'Spin'] } })
    expect(coerceValue(m, 'yoga, Boxing, yoga')).toMatchObject({
      ok: true,
      value: { value: '["Yoga","Boxing"]', value_text_array: ['Yoga', 'Boxing'] },
    })
    expect(coerceValue(m, ['Spin'])).toMatchObject({ value: { value_text_array: ['Spin'] } })
    expect(coerceValue(m, '["Spin"]')).toMatchObject({ value: { value_text_array: ['Spin'] } })
    expect(coerceValue(m, 'Pilates')).toMatchObject({ ok: false })
  })

  it('shape-checks reference ids', () => {
    const r = f({ field_type: 'reference', field_options: { table_key: 'trainers' } })
    const id = '3F2504E0-4F89-11D3-9A0C-0305E82C3301'
    expect(coerceValue(r, id)).toMatchObject({ ok: true, value: { value: id.toLowerCase() } })
    expect(coerceValue(r, 'not-a-uuid')).toMatchObject({ ok: false })
  })
})

describe('keys', () => {
  it('slugifies names into valid keys', () => {
    expect(slugifyKey('Started date')).toBe('started_date')
    expect(slugifyKey('  Amount (₦)  ')).toBe('amount')
    expect(slugifyKey('2024 plan')).toBe('f_2024_plan')
    expect(slugifyKey('###')).toBe('field')
  })
  it('rejects reserved and malformed keys', () => {
    expect(isValidKey('plan')).toBe(true)
    expect(isValidKey('name')).toBe(false)
    expect(isValidKey('Plan')).toBe(false)
    expect(isValidKey('1plan')).toBe(false)
  })
})

describe('validateFieldOptions', () => {
  it('requires options for choice types and a table for references', () => {
    expect(validateFieldOptions('enum', {})).toMatchObject({ ok: false })
    expect(validateFieldOptions('enum', { options: ['A', 'a'] })).toMatchObject({ ok: false })
    expect(validateFieldOptions('enum', { options: ['A', 'B'] })).toEqual({ ok: true })
    expect(validateFieldOptions('reference', {})).toMatchObject({ ok: false })
    expect(validateFieldOptions('reference', { table_key: 'trainers' })).toEqual({ ok: true })
    expect(validateFieldOptions('number', { min: 5, max: 1 })).toMatchObject({ ok: false })
    expect(validateFieldOptions('text', undefined)).toEqual({ ok: true })
  })
})

describe('planTypedValueWrites', () => {
  const fields: FieldDef[] = [
    f({ id: 'a', field_type: 'number', field_name: 'Amount' }),
    f({ id: 'b', field_type: 'text', field_name: 'Note' }),
    f({ id: 'c', field_type: 'bool', field_name: 'Auto-renew' }),
  ]
  it('splits upserts, clears and errors, ignoring unknown fields', () => {
    const plan = planTypedValueWrites('c1', fields, {
      a: '15,000',
      b: '',
      c: 'maybe',
      gone: 'x',
    })
    expect(plan.upserts).toEqual([
      expect.objectContaining({ contact_id: 'c1', custom_field_id: 'a', value: '15000', value_number: 15000 }),
    ])
    expect(plan.clearedFieldIds).toEqual(['b'])
    expect(Object.keys(plan.errors)).toEqual(['c'])
  })
})
