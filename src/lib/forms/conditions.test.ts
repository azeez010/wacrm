import { describe, expect, it } from 'vitest'

import { answerValues, computeVisibility, findConditionProblem, ruleHolds, sanitizeConditions, type ConditionalField } from './conditions'

const f = (id: string, kind: string, visibleWhen?: ConditionalField['visibleWhen']): ConditionalField => ({ id, kind, visibleWhen })

describe('ruleHolds', () => {
  it('compares text case-insensitively', () => {
    expect(ruleHolds({ fieldId: 'a', op: 'eq', value: 'Yes' }, 'yes')).toBe(true)
    expect(ruleHolds({ fieldId: 'a', op: 'neq', value: 'yes' }, 'no')).toBe(true)
    expect(ruleHolds({ fieldId: 'a', op: 'contains', value: 'lag' }, 'Lagos')).toBe(true)
  })
  it('handles multi-select, booleans and empty answers', () => {
    expect(ruleHolds({ fieldId: 'a', op: 'eq', value: 'b' }, ['a', 'b'])).toBe(true)
    expect(ruleHolds({ fieldId: 'a', op: 'eq', value: 'true' }, true)).toBe(true)
    expect(ruleHolds({ fieldId: 'a', op: 'eq', value: 'false' }, false)).toBe(true)
    expect(ruleHolds({ fieldId: 'a', op: 'filled' }, '  ')).toBe(false)
    expect(ruleHolds({ fieldId: 'a', op: 'empty' }, undefined)).toBe(true)
    expect(ruleHolds({ fieldId: 'a', op: 'neq', value: 'x' }, undefined)).toBe(true)
  })
  it('compares numbers', () => {
    expect(ruleHolds({ fieldId: 'a', op: 'gt', value: '10' }, '12')).toBe(true)
    expect(ruleHolds({ fieldId: 'a', op: 'lt', value: '10' }, 12)).toBe(false)
    expect(ruleHolds({ fieldId: 'a', op: 'gt', value: '10' }, 'abc')).toBe(false)
    expect(ruleHolds({ fieldId: 'a', op: 'gt', value: '10' }, undefined)).toBe(false)
  })
  it('normalizes answers', () => {
    expect(answerValues(['x', ' ', 'y'])).toEqual(['x', 'y'])
    expect(answerValues(0)).toEqual(['0'])
  })
})

describe('computeVisibility', () => {
  it('shows fields without a condition', () => {
    expect(computeVisibility([f('a', 'name')], {})).toEqual({ a: true })
  })
  it('all / any', () => {
    const rules = [
      { fieldId: 'a', op: 'eq' as const, value: 'x' },
      { fieldId: 'b', op: 'eq' as const, value: 'y' },
    ]
    const fields = [f('a', 'custom_field'), f('b', 'custom_field'), f('c', 'message', { match: 'all', rules }), f('d', 'message', { match: 'any', rules })]
    expect(computeVisibility(fields, { a: 'x', b: 'n' })).toMatchObject({ c: false, d: true })
    expect(computeVisibility(fields, { a: 'x', b: 'y' })).toMatchObject({ c: true, d: true })
  })
  it('a hidden source counts as unanswered, so chains cascade', () => {
    const fields = [
      f('a', 'custom_field'),
      f('b', 'custom_field', { match: 'all', rules: [{ fieldId: 'a', op: 'eq', value: 'yes' }] }),
      f('c', 'message', { match: 'all', rules: [{ fieldId: 'b', op: 'filled' }] }),
    ]
    // b has an old answer but is hidden (a = no), so c must hide too.
    expect(computeVisibility(fields, { a: 'no', b: 'stale' })).toEqual({ a: true, b: false, c: false })
    expect(computeVisibility(fields, { a: 'yes', b: 'ok' })).toEqual({ a: true, b: true, c: true })
  })
  it('a rule pointing at a missing field sees no answer', () => {
    const fields = [f('c', 'message', { match: 'all', rules: [{ fieldId: 'gone', op: 'empty' }] })]
    expect(computeVisibility(fields, {})).toEqual({ c: true })
  })
})

describe('findConditionProblem / sanitizeConditions', () => {
  const rule = (fieldId: string) => ({ match: 'all' as const, rules: [{ fieldId, op: 'eq' as const, value: 'x' }] })
  it('accepts a rule on an earlier field', () => {
    expect(findConditionProblem([f('a', 'custom_field'), f('b', 'message', rule('a'))])).toBeNull()
  })
  it('rejects forward, self and missing references', () => {
    expect(findConditionProblem([f('b', 'message', rule('a')), f('a', 'custom_field')])?.index).toBe(0)
    expect(findConditionProblem([f('a', 'message', rule('a'))])?.index).toBe(0)
    expect(findConditionProblem([f('a', 'message', rule('nope'))])?.index).toBe(0)
  })
  it('rejects untestable sources, conditional phone and missing values', () => {
    expect(findConditionProblem([f('t', 'tag_picker'), f('b', 'message', rule('t'))])?.index).toBe(1)
    expect(findConditionProblem([f('a', 'name'), f('p', 'phone', rule('a'))])?.index).toBe(1)
    expect(findConditionProblem([f('a', 'name'), f('b', 'message', { match: 'all', rules: [{ fieldId: 'a', op: 'eq' }] })])?.index).toBe(1)
  })
  it('sanitize drops dead rules and empty conditions', () => {
    const out = sanitizeConditions([f('b', 'message', rule('a')), f('a', 'custom_field'), f('c', 'message', rule('a'))])
    expect(out[0].visibleWhen).toBeUndefined()
    expect(out[2].visibleWhen).toBeDefined()
  })
})
