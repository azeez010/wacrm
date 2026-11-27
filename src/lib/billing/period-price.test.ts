import { describe, expect, it } from 'vitest'
import { availablePeriods, bestPromo, bestSavings, perMonth, periodTotal, savingsPercent } from './period-price'

const starter = { price_monthly: 15000, price_quarterly: 40500, price_annual: 144000 }
const free = { price_monthly: 0, price_quarterly: 0, price_annual: 0 }

describe('period pricing', () => {
  it('spreads each period over its months', () => {
    expect(perMonth(starter, 'monthly')).toBe(15000)
    expect(perMonth(starter, 'quarterly')).toBe(13500)
    expect(perMonth(starter, 'annual')).toBe(12000)
    expect(periodTotal(starter, 'annual')).toBe(144000)
  })
  it('computes the saving from the data', () => {
    expect(savingsPercent(starter, 'quarterly')).toBe(10)
    expect(savingsPercent(starter, 'annual')).toBe(20)
    expect(savingsPercent(starter, 'monthly')).toBe(0)
    expect(savingsPercent(free, 'annual')).toBe(0)
    expect(savingsPercent({ ...starter, price_annual: 999999 }, 'annual')).toBe(0)
  })
  it('only offers periods that some plan prices', () => {
    expect(availablePeriods([free, starter])).toEqual(['monthly', 'quarterly', 'annual'])
    expect(availablePeriods([free, { ...starter, price_quarterly: 0 }])).toEqual(['monthly', 'annual'])
    expect(availablePeriods([free])).toEqual(['monthly'])
    expect(bestSavings([free, starter], 'annual')).toBe(20)
  })
})

describe('admin promo badge text', () => {
  const plans = [
    { ...free, promo_quarterly: null, promo_annual: null },
    { ...starter, promo_quarterly: null, promo_annual: 'Launch' },
    { price_monthly: 45000, price_quarterly: 121500, price_annual: 360000, promo_quarterly: ' Black Friday ', promo_annual: 'Black Friday' },
  ]
  it('uses the label on the plan with the biggest saving, trimmed', () => {
    expect(bestPromo(plans, 'quarterly')).toBe('Black Friday')
    expect(bestPromo(plans, 'annual')).toBe('Black Friday') // Pro saves 33%, Starter 20%
  })
  it('has none for monthly, or when no plan sets one', () => {
    expect(bestPromo(plans, 'monthly')).toBeNull()
    expect(bestPromo([{ ...starter, promo_quarterly: '', promo_annual: undefined }], 'annual')).toBeNull()
  })
})
