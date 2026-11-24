import { describe, expect, it } from 'vitest'

import { formFieldsSchema, parseFormFields, type FormField } from './types'
import { validateAnswers } from './validate-answers'
import { scoreAnswers } from './scoring'

const ctx = { accountId: 'acct', defaultCountry: 'NG', customFields: new Map(), tableColumns: new Map() }

const fields: FormField[] = [
  { id: 'phone', kind: 'phone', label: 'Phone' },
  { id: 'name', kind: 'name', label: 'Name', required: true },
  { id: 'company', kind: 'company', label: 'Company' },
  {
    id: 'message',
    kind: 'message',
    label: 'Tell us more',
    required: true,
    visibleWhen: { match: 'all', rules: [{ fieldId: 'company', op: 'filled' }] },
  },
]

describe('conditional fields on the server', () => {
  it('a hidden required field does not block the submission and its answer is dropped', () => {
    const r = validateAnswers(fields, { phone: '08031234567', name: 'Ada', message: 'sneaky' }, ctx)
    expect(r.ok).toBe(true)
    expect(r.message).toBeUndefined()
    expect(r.snapshot.message).toBeUndefined()
  })

  it('becomes required once its condition holds', () => {
    const r = validateAnswers(fields, { phone: '08031234567', name: 'Ada', company: 'Acme' }, ctx)
    expect(r.ok).toBe(false)
    expect(r.errors.message).toBe('required')
    const ok = validateAnswers(fields, { phone: '08031234567', name: 'Ada', company: 'Acme', message: 'Hi' }, ctx)
    expect(ok.ok).toBe(true)
    expect(ok.message).toBe('Hi')
  })

  it('scoring ignores hidden fields', () => {
    const scored: FormField[] = [
      { id: 'a', kind: 'name', label: 'a' },
      { id: 'q', kind: 'custom_field', label: 'q', points: { yes: 50 }, visibleWhen: { match: 'all', rules: [{ fieldId: 'a', op: 'eq', value: 'show' }] } },
    ]
    const settings = { qualification: { enabled: true, threshold: 10 } } as never
    expect(scoreAnswers(scored, { a: 'hide', q: 'yes' }, settings).score).toBe(0)
    expect(scoreAnswers(scored, { a: 'show', q: 'yes' }, settings).score).toBe(50)
  })
})

describe('field schema', () => {
  it('accepts a condition on an earlier field', () => {
    expect(formFieldsSchema.safeParse(fields).success).toBe(true)
  })
  it('rejects a condition on a later field when writing', () => {
    const bad: FormField[] = [fields[3], fields[2]]
    expect(formFieldsSchema.safeParse(bad).success).toBe(false)
  })
  it('still loads a stored form with a stale condition (reads are tolerant)', () => {
    const stale = [fields[3]] // refers to "company", which is gone
    expect(parseFormFields(stale)).toHaveLength(1)
  })
})
