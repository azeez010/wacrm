import { describe, expect, it } from 'vitest'
import { resolvePackFilter } from './apply'
import { GYM_PACK } from './gym'
import { validateFieldOptions, isValidKey } from '@/lib/custom-fields/coerce'
import { normalizeFilter } from '@/lib/segments/validate'

describe('GYM_PACK', () => {
  it('only uses valid keys and field options', () => {
    for (const f of GYM_PACK.fields) {
      expect(isValidKey(f.key)).toBe(true)
      expect(validateFieldOptions(f.type, f.options ?? {})).toEqual({ ok: true })
    }
    for (const t of GYM_PACK.tables ?? []) {
      expect(isValidKey(t.key)).toBe(true)
      expect(t.columns.some((c) => c.key === t.label_field_key)).toBe(true)
    }
  })
  it('points its reference field at a table the pack creates', () => {
    const ref = GYM_PACK.fields.find((f) => f.type === 'reference')
    expect(GYM_PACK.tables?.some((t) => t.key === ref?.options?.table_key)).toBe(true)
  })
})

describe('resolvePackFilter', () => {
  it('replaces cf:@key with real field ids so the filter normalises cleanly', () => {
    const ids = new Map(GYM_PACK.fields.map((f, i) => [f.key, `id-${i}`]))
    const kinds = Object.fromEntries(GYM_PACK.fields.map((f, i) => [`id-${i}`, f.type]))
    for (const seg of GYM_PACK.segments ?? []) {
      const resolved = resolvePackFilter(seg.filter, ids)
      expect(JSON.stringify(resolved)).not.toContain('cf:@')
      expect(normalizeFilter(resolved, kinds).rules).toHaveLength(seg.filter.rules.length)
    }
  })
  it('leaves unknown keys untouched instead of guessing', () => {
    const out = resolvePackFilter(
      { version: 1, op: 'and', rules: [{ field: 'cf:@nope', operator: 'is_set' }] },
      new Map(),
    )
    expect(out.rules[0]).toMatchObject({ field: 'cf:@nope' })
  })
})
