import { describe, expect, it } from 'vitest'
import { formatFieldValue, parseMultiValue } from './format'
import { toApiValue } from './contact-values'

describe('formatFieldValue', () => {
  it('formats numbers by option', () => {
    expect(formatFieldValue({ field_type: 'number' }, '15000', { locale: 'en-US' })).toBe('15,000')
    expect(
      formatFieldValue({ field_type: 'number', field_options: { format: 'percent' } }, '12.5', { locale: 'en-US' }),
    ).toBe('12.5%')
    expect(
      formatFieldValue({ field_type: 'number', field_options: { format: 'currency', currency: 'USD' } }, '15000'),
    ).toContain('15,000')
  })
  it('formats booleans, dates, lists and references', () => {
    expect(formatFieldValue({ field_type: 'bool' }, 'true')).toBe('Yes')
    expect(formatFieldValue({ field_type: 'bool' }, 'false', { no: 'Non' })).toBe('Non')
    expect(formatFieldValue({ field_type: 'date' }, '2026-11-02T00:00:00.000Z', { locale: 'en-US' })).toBe('Nov 2, 2026')
    expect(formatFieldValue({ field_type: 'multi_enum' }, '["A","B"]')).toBe('A, B')
    expect(formatFieldValue({ field_type: 'reference' }, 'id1', { resolveReference: () => 'Chidi' })).toBe('Chidi')
    expect(formatFieldValue({ field_type: 'reference' }, 'id1')).toBe('')
    expect(formatFieldValue({ field_type: 'text' }, '')).toBe('')
  })
  it('parses multi values defensively', () => {
    expect(parseMultiValue('not json')).toEqual([])
    expect(parseMultiValue(null)).toEqual([])
  })
})

describe('toApiValue', () => {
  it('returns JSON-typed values', () => {
    expect(toApiValue({ field_type: 'number' }, '15000')).toBe(15000)
    expect(toApiValue({ field_type: 'bool' }, 'true')).toBe(true)
    expect(toApiValue({ field_type: 'multi_enum' }, '["A"]')).toEqual(['A'])
    expect(toApiValue({ field_type: 'text' }, 'hi')).toBe('hi')
    expect(toApiValue({ field_type: 'text' }, '')).toBeNull()
  })
})
