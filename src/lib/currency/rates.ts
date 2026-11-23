import type { SupabaseClient } from '@supabase/supabase-js'
import type { RateMap } from './convert'
import { SUPPORTED_CURRENCIES } from './supported'

// Rates come from one free API call per day, cached in the database. A failed
// fetch never breaks pages: we keep serving the last cached rates and retry
// no sooner than an hour later (so a flaky or rate-limiting API is not hammered).

export const RATES_URL = (base: string) => `https://open.er-api.com/v6/latest/${base}`
export const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000
export const RETRY_AFTER_MS = 60 * 60 * 1000

export interface CurrencyConfig {
  base: string
  convertDisplay: boolean
  rates: RateMap
  fetchedAt: string | null
}

const FALLBACK: CurrencyConfig = { base: 'NGN', convertDisplay: true, rates: {}, fetchedAt: null }
let memo: { at: number; value: CurrencyConfig } | null = null
const MEMO_MS = 5 * 60 * 1000

export function resetCurrencyMemo(): void {
  memo = null
}

/** Settings + cached rates (only rates fetched for the current base). Never throws. */
export async function getCurrencyConfig(db: SupabaseClient): Promise<CurrencyConfig> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.value
  try {
    const { data: s } = await db.from('currency_settings').select('base_currency, convert_display, rates_fetched_at').eq('id', 1).maybeSingle()
    const base = (s?.base_currency as string | undefined) ?? FALLBACK.base
    const { data: rows } = await db.from('exchange_rates').select('quote, rate').eq('base', base)
    const rates: RateMap = {}
    for (const r of (rows ?? []) as Array<{ quote: string; rate: number | string }>) rates[r.quote] = Number(r.rate)
    const value: CurrencyConfig = {
      base,
      convertDisplay: s?.convert_display ?? true,
      rates,
      fetchedAt: (s?.rates_fetched_at as string | null) ?? null,
    }
    memo = { at: Date.now(), value }
    return value
  } catch (err) {
    console.error('[currency] config read failed:', err instanceof Error ? err.message : err)
    return memo?.value ?? FALLBACK
  }
}

type RefreshResult = 'refreshed' | 'fresh' | 'backoff' | 'failed'

/**
 * Refresh the cached rates if they are older than a day (or the base changed).
 * `fetchImpl` is injectable for tests. Safe to call as often as you like.
 */
export async function refreshRates(db: SupabaseClient, opts: { force?: boolean; fetchImpl?: typeof fetch; now?: number } = {}): Promise<RefreshResult> {
  const now = opts.now ?? Date.now()
  const { data: s } = await db.from('currency_settings').select('base_currency, rates_fetched_at, last_attempt_at').eq('id', 1).maybeSingle()
  const base = (s?.base_currency as string | undefined) ?? FALLBACK.base

  const { count } = await db.from('exchange_rates').select('quote', { count: 'exact', head: true }).eq('base', base)
  const haveRatesForBase = (count ?? 0) > 0
  const fetchedAt = s?.rates_fetched_at ? Date.parse(s.rates_fetched_at as string) : 0
  const lastAttempt = s?.last_attempt_at ? Date.parse(s.last_attempt_at as string) : 0

  if (!opts.force && haveRatesForBase && now - fetchedAt < REFRESH_AFTER_MS) return 'fresh'
  if (!opts.force && now - lastAttempt < RETRY_AFTER_MS) return 'backoff'

  const stamp = new Date(now).toISOString()
  await db.from('currency_settings').update({ last_attempt_at: stamp }).eq('id', 1)
  try {
    const res = await (opts.fetchImpl ?? fetch)(RATES_URL(base), { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as { result?: string; rates?: Record<string, number> }
    if (json.result !== 'success' || !json.rates) throw new Error('unexpected response')

    // Keep manual overrides (set by the admin) untouched.
    const { data: overrides } = await db.from('exchange_rates').select('quote').eq('base', base).eq('is_override', true)
    const locked = new Set(((overrides ?? []) as Array<{ quote: string }>).map((o) => o.quote))
    const rows = SUPPORTED_CURRENCIES.filter((q) => q !== base && !locked.has(q) && typeof json.rates![q] === 'number' && json.rates![q] > 0).map((q) => ({
      base,
      quote: q,
      rate: json.rates![q],
      source: 'open.er-api.com',
      fetched_at: stamp,
    }))
    if (rows.length === 0) throw new Error('no usable rates')
    const { error } = await db.from('exchange_rates').upsert(rows, { onConflict: 'base,quote' })
    if (error) throw new Error(error.message)

    await db.from('currency_settings').update({ rates_fetched_at: stamp, last_error: null, updated_at: stamp }).eq('id', 1)
    await db.from('currency_audit_log').insert({ action: 'rates_refreshed', detail: { base, count: rows.length } })
    resetCurrencyMemo()
    return 'refreshed'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[currency] refresh failed (serving cached rates):', message)
    await db.from('currency_settings').update({ last_error: message.slice(0, 300) }).eq('id', 1)
    await db.from('currency_audit_log').insert({ action: 'rates_refresh_failed', detail: { base, error: message.slice(0, 300) } })
    return 'failed'
  }
}
