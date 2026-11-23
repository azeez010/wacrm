// /api/currency - what currency to show this visitor, and the rates to convert with.
//   GET  → { enabled, base, current, options, rates }   (public)
//   POST { currency } → remember the visitor's choice in a cookie
// Prices are stored in the base currency (NGN); conversion is for display only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { getCurrencyConfig } from '@/lib/currency/rates'
import { CURRENCY_COOKIE } from '@/lib/currency/convert'
import { getDisplayCurrency } from '@/lib/currency/server'
import { isSupportedCurrency } from '@/lib/currency/supported'

export async function GET() {
  return NextResponse.json(await getDisplayCurrency(), { headers: { 'Cache-Control': 'private, max-age=60' } })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { currency?: unknown } | null
  const code = typeof body?.currency === 'string' ? body.currency.toUpperCase() : ''
  const cfg = await getCurrencyConfig(supabaseAdmin())
  if (!isSupportedCurrency(code) || (code !== cfg.base && !cfg.rates[code])) {
    return NextResponse.json({ error: 'Unsupported currency' }, { status: 400 })
  }
  const res = NextResponse.json({ ok: true, current: code })
  res.cookies.set(CURRENCY_COOKIE, code, { maxAge: 365 * 24 * 60 * 60, path: '/', sameSite: 'lax', secure: new URL(request.url).protocol === 'https:' })
  return res
}
