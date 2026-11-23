import { cookies, headers } from 'next/headers'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { CURRENCY_COOKIE, convertAmount, pickDisplayCurrency, type RateMap } from './convert'
import { getCurrencyConfig } from './rates'

export interface DisplayCurrency {
  enabled: boolean
  base: string
  current: string
  options: string[]
  rates: RateMap
}

/** What to show this visitor (cookie → country → USD → base), with the rates to convert by. */
export async function getDisplayCurrency(): Promise<DisplayCurrency> {
  const [jar, hdrs, cfg] = await Promise.all([cookies(), headers(), getCurrencyConfig(supabaseAdmin())])
  const current = pickDisplayCurrency({
    cookie: jar.get(CURRENCY_COOKIE)?.value,
    country: hdrs.get('cf-ipcountry'),
    base: cfg.base,
    enabled: cfg.convertDisplay,
    rates: cfg.rates,
  })
  return {
    enabled: cfg.convertDisplay,
    base: cfg.base,
    current,
    options: cfg.convertDisplay ? [cfg.base, ...Object.keys(cfg.rates).sort()] : [cfg.base],
    rates: cfg.convertDisplay ? cfg.rates : {},
  }
}

/** Convert a stored price (in `from`) for display; returns the amount and currency to show. */
export function toDisplay(fx: DisplayCurrency, amount: number, from: string): { amount: number; currency: string; converted: boolean } {
  if (from === fx.current) return { amount, currency: from, converted: false }
  const v = convertAmount(amount, from, fx.current, fx.base, fx.rates)
  return v == null ? { amount, currency: from, converted: false } : { amount: v, currency: fx.current, converted: amount !== 0 }
}
