import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from '@/test-utils/fake-db'
import { convertAmount, friendlyRound, pickDisplayCurrency } from './convert'
import { currencyForCountry } from './supported'
import { getCurrencyConfig, refreshRates, resetCurrencyMemo, REFRESH_AFTER_MS, RETRY_AFTER_MS } from './rates'

describe('convert', () => {
  const rates = { USD: 0.00065, GHS: 0.0095, GBP: 0.0005 } // per 1 NGN
  it('rounds friendly', () => {
    expect(friendlyRound(9.8731)).toBe(9.85)
    expect(friendlyRound(29.2)).toBe(29)
    expect(friendlyRound(123.4)).toBe(123)
    expect(friendlyRound(12345)).toBe(12350)
    expect(friendlyRound(0)).toBe(0)
  })
  it('converts base → quote and between two quotes via the base', () => {
    expect(convertAmount(15000, 'NGN', 'USD', 'NGN', rates)).toBe(9.75)
    expect(convertAmount(10, 'USD', 'NGN', 'NGN', rates)).toBe(15380)
    expect(convertAmount(10, 'USD', 'GBP', 'NGN', rates)).toBe(7.7)
    expect(convertAmount(5, 'NGN', 'NGN', 'NGN', rates)).toBe(5)
    expect(convertAmount(0, 'NGN', 'USD', 'NGN', rates)).toBe(0)
  })
  it('returns null without a rate', () => {
    expect(convertAmount(100, 'NGN', 'EUR', 'NGN', rates)).toBeNull()
  })
  it('maps countries to currencies', () => {
    expect(currencyForCountry('gh')).toBe('GHS')
    expect(currencyForCountry('FR')).toBe('EUR')
    expect(currencyForCountry('SN')).toBe('XOF')
    expect(currencyForCountry('ZZ')).toBeNull()
  })
  it('picks: base when off; cookie, then country, then USD, then base', () => {
    const base = { base: 'NGN', rates, enabled: true }
    expect(pickDisplayCurrency({ ...base, enabled: false, cookie: 'USD' })).toBe('NGN')
    expect(pickDisplayCurrency({ ...base, cookie: 'gbp', country: 'GH' })).toBe('GBP')
    expect(pickDisplayCurrency({ ...base, country: 'GH' })).toBe('GHS')
    expect(pickDisplayCurrency({ ...base, country: 'NG' })).toBe('NGN')
    expect(pickDisplayCurrency({ ...base, country: 'KE' })).toBe('USD') // no KES rate → USD
    expect(pickDisplayCurrency({ ...base, cookie: 'XXX' })).toBe('USD')
    expect(pickDisplayCurrency({ base: 'NGN', rates: {}, enabled: true, country: 'GH' })).toBe('NGN')
  })
})

describe('rates cache', () => {
  const ok = () => vi.fn().mockImplementation(async () => new Response(JSON.stringify({ result: 'success', rates: { NGN: 1, USD: 0.00065, GBP: 0.0005, GHS: 0.0095, ZZZ: 5 } }), { status: 200 }))
  let db: FakeDb
  beforeEach(() => {
    resetCurrencyMemo()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    db = new FakeDb({}, { currency_settings: [{ id: 1, base_currency: 'NGN', convert_display: true, rates_fetched_at: null, last_attempt_at: null }] })
  })

  it('fetches once, stores only supported quotes, then serves the cache for a day', async () => {
    const f = ok()
    expect(await refreshRates(db.asClient(), { fetchImpl: f as never, now: 1_000_000_000_000 })).toBe('refreshed')
    expect(db.rows('exchange_rates').map((r) => r.quote).sort()).toEqual(['GBP', 'GHS', 'USD'])
    expect(db.rows('currency_audit_log')[0]).toMatchObject({ action: 'rates_refreshed' })
    expect(await refreshRates(db.asClient(), { fetchImpl: f as never, now: 1_000_000_000_000 + REFRESH_AFTER_MS - 1000 })).toBe('fresh')
    expect(f).toHaveBeenCalledTimes(1)
    expect(await refreshRates(db.asClient(), { fetchImpl: f as never, now: 1_000_000_000_000 + REFRESH_AFTER_MS + 1000 })).toBe('refreshed')
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('keeps serving cached rates when the API fails, and backs off for an hour', async () => {
    await refreshRates(db.asClient(), { fetchImpl: ok() as never, now: 1_000_000_000_000 })
    const bad = vi.fn().mockResolvedValue(new Response('no', { status: 429 }))
    const later = 1_000_000_000_000 + REFRESH_AFTER_MS + 1000
    expect(await refreshRates(db.asClient(), { fetchImpl: bad as never, now: later })).toBe('failed')
    expect(await refreshRates(db.asClient(), { fetchImpl: bad as never, now: later + 60_000 })).toBe('backoff')
    expect(bad).toHaveBeenCalledTimes(1)
    expect(await refreshRates(db.asClient(), { fetchImpl: ok() as never, now: later + RETRY_AFTER_MS + 1000 })).toBe('refreshed')
    resetCurrencyMemo()
    const cfg = await getCurrencyConfig(db.asClient())
    expect(cfg.rates.USD).toBe(0.00065)
    expect(db.rows('currency_settings')[0].last_error).toBeNull()
    expect(db.rows('currency_audit_log').some((r) => r.action === 'rates_refresh_failed')).toBe(true)
  })
  it('does not overwrite admin overrides, and refetches when the base changes', async () => {
    db.rows('exchange_rates').push({ base: 'NGN', quote: 'USD', rate: 0.001, is_override: true })
    await refreshRates(db.asClient(), { fetchImpl: ok() as never, force: true, now: 1_000_000_000_000 })
    expect(db.rows('exchange_rates').find((r) => r.quote === 'USD')!.rate).toBe(0.001)
    // Changing the base (admin) also clears the retry timer so the new base fetches at once.
    Object.assign(db.rows('currency_settings')[0], { base_currency: 'GBP', last_attempt_at: null })
    const f = ok()
    expect(await refreshRates(db.asClient(), { fetchImpl: f as never, now: 1_000_000_000_000 + 10 })).toBe('refreshed') // no rates for GBP yet
    expect(String(f.mock.calls[0][0])).toContain('/latest/GBP')
  })
  it('falls back to defaults when the database is unreachable', async () => {
    const broken = { from: () => { throw new Error('down') } } as never
    expect(await getCurrencyConfig(broken)).toMatchObject({ base: 'NGN', convertDisplay: true, rates: {} })
  })
})
