import { describe, expect, it } from 'vitest'

import { FORMS_REFERENCE } from './forms-tools'

describe('forms authoring guide', () => {
  it('explains conditional fields (visibleWhen) so agents can build them', () => {
    const text = JSON.stringify(FORMS_REFERENCE)
    expect(FORMS_REFERENCE.field_shape.visibleWhen).toBeTruthy()
    for (const op of ['eq', 'neq', 'contains', 'filled', 'empty', 'gt', 'lt']) {
      expect(Object.keys(FORMS_REFERENCE.conditional_fields.operators)).toContain(op)
    }
    expect(text).toContain('EARLIER field')
  })
})
