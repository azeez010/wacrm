import { describe, expect, it } from 'vitest'
import { availablePeriods, bestSavings, perMonth, periodTotal, savingsPercent } from './period-price'

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
