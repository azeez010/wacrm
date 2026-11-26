import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'

import { CURRENCY_COOKIE } from '@/lib/currency/convert'
import { currencyForCountry, isSupportedCurrency } from '@/lib/currency/supported'
import { PAYMENT_METHODS, type PaymentMethod } from './catalogue'
import { getRoute } from './checkout'

export type PaymentMode = 'off' | 'test' | 'live'
export interface CustomerPaymentContext {
  mode: PaymentMode
  country: string | null
  currency: string
  transferExpiryDays: number
}

/** off | test | live for this account (admin.payment_settings), plus where the customer is and what they pay in.
 *  Country: Cloudflare's cf-ipcountry, else the profile's country. Currency: the currency-switcher cookie,
 *  else the country's currency, else NGN. Any error -> mode 'off' (the existing free switch keeps working). */
export async function customerPaymentContext(db: SupabaseClient, accountId: string, userId: string): Promise<CustomerPaymentContext> {
  let mode: PaymentMode = 'off'
  let transferExpiryDays = 7
  try {
    const { data } = await db.rpc('payment_checkout_settings', { p_account: accountId })
    const s = data as { mode?: string; transferExpiryDays?: number } | null
    if (s?.mode === 'test' || s?.mode === 'live') mode = s.mode
    if (typeof s?.transferExpiryDays === 'number') transferExpiryDays = s.transferExpiryDays
  } catch {
    mode = 'off'
  }
  const [h, jar] = await Promise.all([headers(), cookies()])
  let country = h.get('cf-ipcountry')?.toUpperCase() ?? null
  if (!country || country === 'XX' || country === 'T1') {
    const { data } = await db.from('profiles').select('country').eq('user_id', userId).maybeSingle()
    country = typeof data?.country === 'string' && /^[A-Z]{2}$/i.test(data.country) ? data.country.toUpperCase() : null
  }
  const cookie = jar.get(CURRENCY_COOKIE)?.value?.toUpperCase()
  const currency = cookie && isSupportedCurrency(cookie) ? cookie : currencyForCountry(country) ?? 'NGN'
  return { mode, country, currency, transferExpiryDays }
}

export type MethodOption = { method: PaymentMethod; available: boolean; amount: number | null; currency: string | null }

/** Which methods this customer can use for a plan/interval, and the price the first instance would charge. */
export async function methodOptions(db: SupabaseClient, pc: CustomerPaymentContext, planId: string, interval: string): Promise<MethodOption[]> {
  if (pc.mode === 'off') return PAYMENT_METHODS.map((method) => ({ method, available: false, amount: null, currency: null }))
  const mode = pc.mode
  return Promise.all(PAYMENT_METHODS.map(async (method) => {
    const first = (await getRoute(db, pc.country, pc.currency, method, mode)).find((r) => !r.reason && r.chargeCurrency)
    if (!first) return { method, available: false, amount: null, currency: null }
    const { data } = await db.rpc('payment_quote', { p_plan: planId, p_interval: interval, p_currency: first.chargeCurrency })
    const q = data as { amount: number; currency: string } | null
    return { method, available: !!q, amount: q ? Number(q.amount) : null, currency: q?.currency ?? null }
  }))
}
