import { COUNTRY_CURRENCY, isSupportedCurrency, type CurrencyCode } from './supported'

export type RateMap = Record<string, number> // units of `quote` per 1 unit of base

/** Friendly rounding for converted prices: ≥1000 → nearest 10, ≥100 → 1, ≥10 → 0.5, else 0.05. */
export function friendlyRound(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1000) return Math.round(value / 10) * 10
  if (value >= 100) return Math.round(value)
  if (value >= 10) return Math.round(value * 2) / 2
  return Math.round(value * 20) / 20
}

/** Convert an amount stored in `from` into `to` through the base-relative rates. Null when a rate is missing. */
export function convertAmount(amount: number, from: string, to: string, base: string, rates: RateMap): number | null {
  if (from === to) return amount
  const rate = (c: string): number | null => (c === base ? 1 : rates[c] ?? null)
  const rf = rate(from)
  const rt = rate(to)
  if (!rf || !rt) return null
  const converted = (amount / rf) * rt
  return amount === 0 ? 0 : friendlyRound(converted)
}

export interface CurrencyChoice {
  /** Cookie the visitor set via the switcher. */
  cookie?: string | null
  /** `cf-ipcountry`. */
  country?: string | null
  base: string
  enabled: boolean
  rates: RateMap
}

/**
 * The currency to show: the base when conversion is switched off, else the
 * visitor's choice, else their country's currency, else USD, else the base.
 * Only currencies we hold a rate for are eligible.
 */
export function pickDisplayCurrency(c: CurrencyChoice): string {
  if (!c.enabled) return c.base
  const available = (code: string | null | undefined): code is string => !!code && isSupportedCurrency(code) && (code === c.base || !!c.rates[code])
  const cookie = c.cookie?.toUpperCase()
  if (available(cookie)) return cookie
  const byCountry = c.country ? COUNTRY_CURRENCY[c.country.toUpperCase()] : undefined
  if (available(byCountry)) return byCountry
  if (available('USD')) return 'USD'
  return c.base
}

export const CURRENCY_COOKIE = 'ogadesk_currency'
export type { CurrencyCode }
