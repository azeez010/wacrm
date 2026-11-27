import { describe, expect, it } from 'vitest'
import { MARKET_RATES, RATES_CHECKED, RATES_EFFECTIVE } from './whatsapp-rates'

describe('whatsapp rates data', () => {
  it('has valid dates and numeric rates for every market', () => {
    expect(RATES_EFFECTIVE).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(RATES_CHECKED >= RATES_EFFECTIVE).toBe(true)
    for (const r of MARKET_RATES) {
      for (const v of [r.marketing, r.utility, r.authentication, r.service]) expect(v).toBeGreaterThan(0)
    }
    expect(MARKET_RATES.find((r) => r.market === 'Nigeria')?.marketing).toBe(0.0516)
    expect(new Set(MARKET_RATES.map((r) => r.market)).size).toBe(MARKET_RATES.length)
  })
})
