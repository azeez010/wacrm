'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMoney } from '@/hooks/use-money'
import { cn } from '@/lib/utils'

export interface CalcPlan {
  id: string
  name: string
  price: number
  currency: string
}

/** "What could you earn": clients x plan price x commission, per month and over the recurring window. */
export function EarningsCalculator({ plans, percent, months }: { plans: CalcPlan[]; percent: number; months: number }) {
  const t = useTranslations('Partner.public')
  const money = useMoney()
  const [clients, setClients] = useState(10)
  const [planId, setPlanId] = useState(plans[Math.min(1, plans.length - 1)]?.id ?? '')
  const plan = plans.find((p) => p.id === planId) ?? plans[0]
  if (!plan) return null

  const monthly = Math.round(clients * plan.price * (percent / 100))
  const total = monthly * Math.max(1, months)

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <p className="text-sm font-medium text-muted-foreground">{t('calcTitle')}</p>
      <p className="mt-2 text-4xl font-bold tracking-tight text-primary sm:text-5xl">
        {money(monthly, plan.currency)}
        <span className="ml-2 text-base font-normal text-muted-foreground">{t('calcPerMonth')}</span>
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{t('calcTotal', { amount: money(total, plan.currency), months })}</p>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between text-sm">
          <label htmlFor="calc-clients" className="font-medium">
            {t('calcClients')}
          </label>
          <span className="rounded-md bg-muted px-2 py-0.5 font-semibold tabular-nums">{clients}</span>
        </div>
        <input
          id="calc-clients"
          type="range"
          min={1}
          max={50}
          value={clients}
          onChange={(e) => setClients(Number(e.target.value))}
          className="w-full accent-primary"
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label={t('calcPlan')}>
        {plans.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPlanId(p.id)}
            aria-pressed={p.id === plan.id}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition-colors',
              p.id === plan.id ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
            )}
          >
            {p.name} · {money(p.price, p.currency)}
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{t('calcNote', { percent })}</p>
    </div>
  )
}
