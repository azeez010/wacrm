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
    ).toEqual({ useCases: ['developer', 'sales'], heardFrom: 'google', heardFromDetail: 'A newsletter', marketingOptIn: true, phone: null, workspaceName: null })
  })

  it('treats the source and opt-in as optional (a skipped second step)', () => {
    expect(ok({ use_cases: ['support'] })).toEqual({ useCases: ['support'], heardFrom: null, heardFromDetail: null, marketingOptIn: false, phone: null, workspaceName: null })
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

describe('parseOnboardingInput: workspace name', () => {
  const base = { use_cases: ['support'] }
  it('trims and collapses spaces, and treats blank as "keep the current name"', () => {
    const r = parseOnboardingInput({ ...base, workspace_name: '  Lagos   Store ' })
    expect(r.ok && r.value.workspaceName).toBe('Lagos Store')
    const blank = parseOnboardingInput({ ...base, workspace_name: '   ' })
    expect(blank.ok && blank.value.workspaceName).toBeNull()
    const missing = parseOnboardingInput(base)
    expect(missing.ok && missing.value.workspaceName).toBeNull()
  })
  it('rejects a name that is too long or not text', () => {
    expect(parseOnboardingInput({ ...base, workspace_name: 'x'.repeat(81) }).ok).toBe(false)
    expect(parseOnboardingInput({ ...base, workspace_name: 42 }).ok).toBe(false)
    expect(parseOnboardingInput({ ...base, workspace_name: 'x'.repeat(80) }).ok).toBe(true)
  })
})
