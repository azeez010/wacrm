import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'

import { CURRENCY_COOKIE } from '@/lib/currency/convert'
import { currencyForCountry, isSupportedCurrency } from '@/lib/currency/supported'
import { PAYMENT_METHODS, type PaymentMethod } from './catalogue'
import { getRoute, priceFor } from './checkout'

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

export type MethodOption = {
  method: PaymentMethod
  available: boolean
  /** What the customer pays (subtotal - discount + fee). */
  amount: number | null
  currency: string | null
  subtotal: number | null
  discount: number
  fee: number
  feePayer: 'customer' | 'business' | null
  /** Why the typed coupon cannot be used with this method/price (not_found, expired, ..., once_not_recurring). */
  couponIssue: string | null
}

const unavailable = (method: PaymentMethod): MethodOption => ({ method, available: false, amount: null, currency: null, subtotal: null, discount: 0, fee: 0, feePayer: null, couponIssue: null })

/** Which methods this customer can use for a plan/interval, and the price the first instance would charge,
 *  line by line (coupon and provider fee included). */
export async function methodOptions(
  db: SupabaseClient, pc: CustomerPaymentContext, planId: string, interval: string, opts: { accountId?: string; couponCode?: string } = {},
): Promise<MethodOption[]> {
  if (pc.mode === 'off') return PAYMENT_METHODS.map(unavailable)
  const mode = pc.mode
  return Promise.all(PAYMENT_METHODS.map(async (method): Promise<MethodOption> => {
    const first = (await getRoute(db, pc.country, pc.currency, method, mode)).find((r) => !r.reason && r.chargeCurrency)
    if (!first) return unavailable(method)
    const { data: pub } = await db.rpc('payment_instance_public', { p_id: first.id })
    const config = ((pub as { config?: Record<string, unknown> } | null)?.config) ?? {}
    const priced = await priceFor(db, { id: planId }, { accountId: opts.accountId ?? '', interval: interval as 'monthly' | 'quarterly' | 'annual', couponCode: opts.accountId ? opts.couponCode : undefined }, first, config)
    if ('error' in priced) {
      if (priced.error === 'coupon_invalid') {
        // Show the plain price and say why the coupon does not apply.
        const plain = await priceFor(db, { id: planId }, { accountId: opts.accountId ?? '', interval: interval as 'monthly' | 'quarterly' | 'annual' }, first, config)
        if ('error' in plain) return unavailable(method)
        return { method, available: true, amount: plain.breakdown.total, currency: plain.breakdown.currency, subtotal: plain.breakdown.subtotal, discount: 0, fee: plain.breakdown.fee, feePayer: plain.breakdown.feePayer, couponIssue: priced.couponReason ?? 'invalid' }
      }
      return unavailable(method)
    }
    const b = priced.breakdown
    return {
      method, available: true, amount: b.total, currency: b.currency, subtotal: b.subtotal, discount: b.discount, fee: b.fee, feePayer: b.feePayer,
      couponIssue: priced.couponDuration === 'once' && method === 'subscription' ? 'once_not_recurring' : null,
    }
  }))
}
