import { describe, expect, it } from 'vitest'
import { parseCrmConfig, parsePartnerPatch } from './input'
import { parseOnboardingInput } from '@/lib/onboarding/options'

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('parseCrmConfig', () => {
  it('accepts ids and defaults autoWon to on', () => {
    expect(parseCrmConfig({ unpaid: { tagId: ID(1), pipelineId: ID(2), stageId: ID(3) }, paid: { tagId: ID(4) } })).toEqual({
      enabled: false,
      unpaid: { tagId: ID(1), pipelineId: ID(2), stageId: ID(3) },
      paid: { tagId: ID(4) },
      autoWon: true,
    })
  })
  it('turns non-uuid values into null and respects autoWon=false', () => {
    const c = parseCrmConfig({ unpaid: { tagId: 'x' }, paid: {}, autoWon: false })
    expect(c?.unpaid).toEqual({ tagId: null, pipelineId: null, stageId: null })
    expect(c?.autoWon).toBe(false)
  })
  it('rejects a stage without its pipeline', () => {
    expect(parseCrmConfig({ unpaid: { stageId: ID(3) } })).toBeNull()
  })
  it('is accepted by parsePartnerPatch and rejected when invalid', () => {
    expect(parsePartnerPatch({ crm_config: { unpaid: {} } }).ok).toBe(true)
    expect(parsePartnerPatch({ crm_config: 'nope' }).ok).toBe(false)
  })
})

describe('onboarding phone', () => {
  const base = { use_cases: ['sales'] }
  it('is optional', () => {
    const r = parseOnboardingInput(base)
    expect(r.ok && r.value.phone).toBeNull()
  })
  it('normalizes a valid international number to digits', () => {
    const r = parseOnboardingInput({ ...base, phone: '+234 801 234 5678' })
    expect(r.ok && r.value.phone).toBe('2348012345678')
  })
  it('rejects a number without +country code', () => {
    expect(parseOnboardingInput({ ...base, phone: '08012345678' }).ok).toBe(false)
  })
})

describe('crm enabled switch', () => {
  it('is off unless explicitly true', () => {
    expect(parseCrmConfig({ unpaid: {} })?.enabled).toBe(false)
    expect(parseCrmConfig({ enabled: true, unpaid: {} })?.enabled).toBe(true)
  })
})
