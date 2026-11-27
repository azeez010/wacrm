'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { Period } from '@/lib/billing/period-price'

const KEY = 'ogd-billing-period'
const Ctx = createContext<Period>('monthly')

type Option = { period: Period; label: string; save: number }

/** Holds the chosen billing period for the pricing section and renders the toggle. Children read it via PlanPrice. */
export function PricingPeriod({
  options, saveLabel, ariaLabel, leading, children,
}: {
  options: Option[]
  /** "Save {percent}%" with {percent} left for us to fill in. */
  saveLabel: string
  ariaLabel: string
  /** The currency picker, so both controls share one row. */
  leading: ReactNode
  children: ReactNode
}) {
  const [period, setPeriod] = useState<Period>('monthly')
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY) as Period | null
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved && options.some((o) => o.period === saved)) setPeriod(saved)
    } catch { /* storage blocked: stay on monthly */ }
  }, [options])
  const choose = (p: Period) => {
    setPeriod(p)
    try { window.localStorage.setItem(KEY, p) } catch { /* ignore */ }
  }
  return (
    <Ctx.Provider value={period}>
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
        {leading}
        {options.length > 1 && (
          <div role="radiogroup" aria-label={ariaLabel} className="inline-flex flex-wrap items-center justify-center gap-1 rounded-full border bg-muted/40 p-1">
            {options.map((o) => (
              <button
                key={o.period}
                type="button"
                role="radio"
                aria-checked={period === o.period}
                onClick={() => choose(o.period)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                  period === o.period ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {o.label}
                {o.save > 0 && (
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', period === o.period ? 'bg-primary-foreground/20' : 'bg-primary/15 text-primary')}>
                    {saveLabel.replace('{percent}', String(o.save))}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      {children}
    </Ctx.Provider>
  )
}

/** The price block of a plan card: per-month figure plus the "billed ..." line for the chosen period. */
export function PlanPrice({
  monthText, billed, perMonthLabel, free,
}: {
  monthText: Record<Period, string>
  billed: Record<Period, string | null>
  perMonthLabel: string
  free: boolean
}) {
  const period = useContext(Ctx)
  const line = billed[period]
  return (
    <>
      <p className="mt-4">
        <span className="text-3xl font-bold">{monthText[period]}</span>
        {!free && <span className="text-sm text-muted-foreground"> {perMonthLabel}</span>}
      </p>
      <p className="min-h-4 text-xs text-muted-foreground">{line}</p>
    </>
  )
}
