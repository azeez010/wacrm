'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { convertAmount, type RateMap } from '@/lib/currency/convert'
import { formatPlanPrice } from '@/lib/billing/format'

interface Fx {
  enabled: boolean
  base: string
  current: string
  rates: RateMap
}

let cached: Promise<Fx | null> | null = null
const CHANGED = 'ogadesk:currency-changed'

/** After the currency cookie changed (no page reload): every money() on the page refetches and re-renders. */
export function refreshMoney() {
  cached = null
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED))
}

const load = (): Promise<Fx | null> =>
  (cached ??= fetch('/api/currency')
    .then((r) => (r.ok ? (r.json() as Promise<Fx>) : null))
    .catch(() => null))

/**
 * `money(amount, storedCurrency)` formats a stored price in the visitor's
 * currency (approximate, marked "≈") when conversion is on and a rate exists;
 * otherwise in the stored currency. Renders the stored price first, then updates.
 */
export function useMoney() {
  const locale = useLocale()
  const [fx, setFx] = useState<Fx | null>(null)
  useEffect(() => {
    let live = true
    const read = () => void load().then((v) => live && setFx(v))
    read()
    window.addEventListener(CHANGED, read)
    return () => {
      live = false
      window.removeEventListener(CHANGED, read)
    }
  }, [])
  return useCallback(
    (amount: number | string, currency: string): string => {
      const n = Number(amount)
      if (!fx || !fx.enabled || fx.current === currency || n === 0) return formatPlanPrice(n, currency, locale)
      const v = convertAmount(n, currency, fx.current, fx.base, fx.rates)
      return v == null ? formatPlanPrice(n, currency, locale) : `≈ ${formatPlanPrice(v, fx.current, locale)}`
    },
    [fx, locale],
  )
}
