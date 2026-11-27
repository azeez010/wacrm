import { describe, expect, it } from 'vitest'
import { monthlyCost } from './wa-cost'
import { MARKET_RATES } from './whatsapp-rates'

const ng = MARKET_RATES.find((r) => r.market === 'Nigeria')!

describe('monthlyCost', () => {
  it('multiplies counts by Meta’s rates', () => {
    const r = monthlyCost(ng, { marketing: 1000, utility: 0, authentication: 0, service: 0, numbers: 1 })
    expect(r.total).toBeCloseTo(51.6, 6)
  })
  it('gives 1,000 free service messages per number', () => {
    expect(monthlyCost(ng, { marketing: 0, utility: 0, authentication: 0, service: 900, numbers: 1 }).total).toBe(0)
    const r = monthlyCost(ng, { marketing: 0, utility: 0, authentication: 0, service: 2500, numbers: 2 })
    expect(r.paidService).toBe(500)
    expect(r.total).toBeCloseTo(500 * 0.0067, 6)
  })
  it('ignores bad input', () => {
    const r = monthlyCost(ng, { marketing: -5, utility: Number.NaN, authentication: 2.7, service: 0, numbers: 0 })
    expect(r.total).toBeCloseTo(2 * 0.0067, 6)
  })
})
