import { describe, expect, it } from 'vitest'
import { countRules, kindOf, normalizeFilter, parseFilter } from './validate'
import { OPERATORS_BY_KIND, valueShape } from './operators'
import type { FilterGroup } from './types'

const kinds = { a1: 'number', p1: 'enum' } as const

describe('normalizeFilter', () => {
  it('drops unfinished, unknown and mismatched rules', () => {
    const g: FilterGroup = {
      version: 1,
      op: 'and',
      rules: [
        { field: 'cf:a1', operator: 'gt', value: '10' },
        { field: 'cf:a1', operator: 'gt', value: '' }, // unfinished
        { field: 'cf:a1', operator: 'contains', value: 'x' }, // wrong operator for number
        { field: 'cf:gone', operator: 'eq', value: '1' }, // unknown field
        { field: 'cf:p1', operator: 'is_any_of', value: [] }, // empty list
        { field: 'cf:p1', operator: 'is_any_of', value: ['Gold'] },
        { field: 'name', operator: 'is_set' },
      ],
    }
    const out = normalizeFilter(g, kinds)
    expect(out.rules).toHaveLength(3)
    expect(countRules(out)).toBe(3)
  })
  it('keeps nested groups only when they have rules', () => {
    const out = normalizeFilter(
      {
        version: 1,
        op: 'or',
        rules: [
          { version: 1, op: 'and', rules: [] },
          { version: 1, op: 'and', rules: [{ field: 'tags', operator: 'has_any', value: ['t1'] }] },
        ],
      },
      kinds,
    )
    expect(out.op).toBe('or')
    expect(out.rules).toHaveLength(1)
  })
  it('requires two values for between', () => {
    const base = { field: 'cf:a1', operator: 'between' as const }
    expect(normalizeFilter({ version: 1, op: 'and', rules: [{ ...base, value: ['1'] }] }, kinds).rules).toHaveLength(0)
    expect(normalizeFilter({ version: 1, op: 'and', rules: [{ ...base, value: ['1', '5'] }] }, kinds).rules).toHaveLength(1)
  })
})

describe('operators', () => {
  it('maps operators to the right value editor', () => {
    expect(valueShape('is_true')).toBe('none')
    expect(valueShape('between')).toBe('pair')
    expect(valueShape('has_all')).toBe('list')
    expect(valueShape('gt')).toBe('single')
  })
  it('offers number-style operators for dates and no is_any_of for references', () => {
    expect(OPERATORS_BY_KIND.date).toEqual(expect.arrayContaining(['gt', 'gte', 'lt', 'lte', 'neq']))
    expect(OPERATORS_BY_KIND.reference).not.toContain('is_any_of')
  })
  it('resolves field kinds', () => {
    expect(kindOf('email', kinds)).toBe('builtin_text')
    expect(kindOf('cf:a1', kinds)).toBe('number')
    expect(kindOf('cf:nope', kinds)).toBeNull()
    expect(kindOf('wat', kinds)).toBeNull()
  })
})

describe('parseFilter', () => {
  it('accepts empty input and rejects malformed filters', () => {
    expect(parseFilter(undefined)).toMatchObject({ ok: true })
    expect(parseFilter({ op: 'xor', rules: [] })).toMatchObject({ ok: false })
    expect(parseFilter({ rules: 'x' })).toMatchObject({ ok: false })
    expect(parseFilter({ rules: [{ field: 1 }] })).toMatchObject({ ok: false })
    expect(parseFilter({ op: 'or', rules: [{ field: 'name', operator: 'is_set' }] })).toMatchObject({ ok: true })
  })
})
