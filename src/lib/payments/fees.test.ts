import { describe, expect, it } from 'vitest'
import { PAYMENT_TYPES, computeFee, homeCurrency, paymentType } from './catalogue'

const paystackNg = { fee_payer: 'customer', fee_percent: '1.5', fee_flat: '100', fee_cap: '2000', fee_flat_waived_below: '2500', fee_percent_intl: '3.9', merchant_country: 'NG' }

// What the business actually receives from a payment of `total` under the same rules.
const received = (cfg: typeof paystackNg, total: number) => {
  const pct = Number(cfg.fee_percent) / 100
  let f = (total < Number(cfg.fee_flat_waived_below) ? 0 : Number(cfg.fee_flat)) + pct * total
  if (Number(cfg.fee_cap) > 0) f = Math.min(f, Number(cfg.fee_cap))
  return total - f
}

describe('computeFee: customer pays', () => {
  it('grosses up so the business receives the full plan price', () => {
    for (const subtotal of [15000, 41033, 45000, 144000]) {
      const r = computeFee(paystackNg, 'NGN', 'NGN', subtotal)
      expect(r.payer).toBe('customer')
      expect(r.total).toBeCloseTo(subtotal + r.fee, 2)
      expect(received(paystackNg, r.total)).toBeGreaterThanOrEqual(subtotal - 0.011)
      expect(received(paystackNg, r.total)).toBeLessThan(subtotal + 0.05)
    }
  })

  it('waives the flat fee for small payments', () => {
    const r = computeFee(paystackNg, 'NGN', 'NGN', 1000)
    expect(r.fee).toBeCloseTo(1000 / 0.985 - 1000, 1) // percent only
    expect(received(paystackNg, r.total)).toBeGreaterThanOrEqual(999.99)
  })

  it('handles the band where adding the flat fee crosses the waiver threshold', () => {
    const r = computeFee(paystackNg, 'NGN', 'NGN', 2450)
    expect(received(paystackNg, r.total)).toBeGreaterThanOrEqual(2449.99)
    expect(received(paystackNg, r.total)).toBeLessThan(2450.1)
  })

  it('stops at the cap', () => {
    const r = computeFee(paystackNg, 'NGN', 'NGN', 500000)
    expect(r.fee).toBe(2000)
    expect(r.total).toBe(502000)
  })

  it('uses the international percentage with no flat fee or cap for other currencies', () => {
    const r = computeFee(paystackNg, 'NGN', 'USD', 30)
    expect(r.fee).toBeCloseTo(30 / (1 - 0.039) - 30, 1)
    expect(r.fee).toBeLessThan(1.3)
  })

  it('falls back to the local percentage when no international one is set', () => {
    const r = computeFee({ ...paystackNg, fee_percent_intl: '' }, 'NGN', 'USD', 100)
    expect(r.fee).toBeCloseTo(100 / 0.985 - 100, 1)
  })

  it('charges nothing when the fee settings are empty or zero', () => {
    expect(computeFee({}, 'NGN', 'NGN', 15000)).toEqual({ payer: 'customer', fee: 0, total: 15000, providerFee: 0 })
    expect(computeFee({ fee_percent: '0', fee_flat: '0' }, 'NGN', 'NGN', 15000).fee).toBe(0)
  })

  it('tolerates numbers and junk in the stored settings', () => {
    expect(computeFee({ fee_percent: 2, fee_flat: 0 }, 'NGN', 'NGN', 1000).fee).toBeCloseTo(1000 / 0.98 - 1000, 1)
    expect(computeFee({ fee_percent: 'abc', fee_flat: -5 }, 'NGN', 'NGN', 1000).fee).toBe(0)
  })

  it('is free for a free subtotal', () => {
    expect(computeFee(paystackNg, 'NGN', 'NGN', 0)).toEqual({ payer: 'customer', fee: 0, total: 0, providerFee: 0 })
  })
})

describe('computeFee: business pays', () => {
  it('adds nothing to the total and reports the expected cost', () => {
    const r = computeFee({ ...paystackNg, fee_payer: 'business' }, 'NGN', 'NGN', 41033)
    expect(r.payer).toBe('business')
    expect(r.fee).toBe(0)
    expect(r.total).toBe(41033)
    expect(r.providerFee).toBeCloseTo(100 + 0.015 * 41033, 1)
  })
})

describe('fee settings in the catalogue', () => {
  it('every payment type has the fee fields, defaulting to the customer paying', () => {
    for (const t of PAYMENT_TYPES) {
      const keys = t.fields.map((f) => f.key)
      for (const k of ['fee_payer', 'fee_percent', 'fee_flat', 'fee_cap', 'fee_flat_waived_below', 'fee_percent_intl']) expect(keys, `${t.kind} ${k}`).toContain(k)
      expect(t.fields.find((f) => f.key === 'fee_payer')!.default).toBe('customer')
    }
  })

  it('manual transfer defaults to no fee; paystack to the Nigeria local rate', () => {
    expect(computeFee(Object.fromEntries(paymentType('manual_transfer')!.fields.map((f) => [f.key, f.default])), 'NGN', 'NGN', 15000).fee).toBe(0)
    const ps = Object.fromEntries(paymentType('paystack')!.fields.map((f) => [f.key, f.default]))
    expect(computeFee(ps, 'NGN', 'NGN', 15000).fee).toBeGreaterThan(0)
  })

  it('the numeric fields validate as numbers', () => {
    const f = paymentType('paystack')!.fields.find((x) => x.key === 'fee_percent')!
    const re = new RegExp(f.pattern!)
    expect(['1.5', '0', '100'].every((v) => re.test(v))).toBe(true)
    expect(['abc', '-1', '1,5', ''].some((v) => re.test(v))).toBe(false)
  })

  it('home currency comes from the instance config', () => {
    expect(homeCurrency('paystack', { merchant_country: 'GH' })).toBe('GHS')
    expect(homeCurrency('manual_transfer', { currency: 'USD' })).toBe('USD')
  })
})
