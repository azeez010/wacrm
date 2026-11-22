import { describe, expect, it } from 'vitest'
import { parseOnboardingInput } from './options'

const ok = (b: unknown) => {
  const r = parseOnboardingInput(b)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('parseOnboardingInput', () => {
  it('accepts a full answer and normalises it', () => {
    expect(
      ok({ use_cases: ['developer', 'sales', 'developer'], heard_from: 'google', heard_from_detail: '  A newsletter ', marketing_opt_in: true }),
    ).toEqual({ useCases: ['developer', 'sales'], heardFrom: 'google', heardFromDetail: 'A newsletter', marketingOptIn: true })
  })

  it('treats the source and opt-in as optional (a skipped second step)', () => {
    expect(ok({ use_cases: ['support'] })).toEqual({ useCases: ['support'], heardFrom: null, heardFromDetail: null, marketingOptIn: false })
    expect(ok({ use_cases: ['support'], heard_from: null, heard_from_detail: '   ' })).toMatchObject({ heardFrom: null, heardFromDetail: null })
  })

  it('rejects bad input', () => {
    for (const bad of [
      null,
      [],
      {},
      { use_cases: [] },
      { use_cases: 'developer' },
      { use_cases: ['developer', 'pirate'] },
      { use_cases: ['support'], heard_from: 'tv' },
      { use_cases: ['support'], heard_from_detail: 'x'.repeat(201) },
      { use_cases: ['support'], heard_from_detail: 5 },
      { use_cases: ['support'], marketing_opt_in: 'yes' },
    ]) {
      expect(parseOnboardingInput(bad).ok).toBe(false)
    }
  })
})
