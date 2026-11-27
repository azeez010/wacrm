'use client'

import { useState } from 'react'
import { monthlyCost } from '@/lib/marketing/wa-cost'
import { MARKET_RATES } from '@/lib/marketing/whatsapp-rates'

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Counts = { marketing: number; utility: number; authentication: number; service: number; numbers: number }

export function WaCostTool() {
  const [market, setMarket] = useState(MARKET_RATES[0]!.market)
  const [v, setV] = useState<Counts>({ marketing: 2000, utility: 1000, authentication: 500, service: 3000, numbers: 1 })
  const rate = MARKET_RATES.find((r) => r.market === market) ?? MARKET_RATES[0]!
  const r = monthlyCost(rate, v)
  const input = 'mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm'
  const field = (key: keyof Counts, label: string, hint: string) => (
    <label className="block text-sm font-medium">
      {label}
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={v[key]}
        onChange={(e) => setV({ ...v, [key]: Number(e.target.value) })}
        className={input}
      />
      <span className="mt-1 block text-xs font-normal text-muted-foreground">{hint}</span>
    </label>
  )
  const rows: [string, number][] = [
    ['Marketing', r.lines.marketing],
    ['Utility', r.lines.utility],
    ['Authentication', r.lines.authentication],
    [`Service (${r.paidService.toLocaleString('en-US')} charged)`, r.lines.service],
  ]
  return (
    <div className="grid gap-6 rounded-xl border bg-card p-5 md:grid-cols-2">
      <div className="space-y-4">
        <label className="block text-sm font-medium">
          Customers’ country
          <select value={market} onChange={(e) => setMarket(e.target.value)} className={input}>
            {MARKET_RATES.map((m) => (
              <option key={m.market} value={m.market}>{m.market}</option>
            ))}
          </select>
        </label>
        {field('marketing', 'Marketing messages a month', `$${rate.marketing} each`)}
        {field('utility', 'Utility messages a month', `$${rate.utility} each (order and booking updates)`)}
        {field('authentication', 'Authentication messages a month', `$${rate.authentication} each (OTP codes)`)}
        {field('service', 'Service replies a month', `$${rate.service} each after the free allowance`)}
        {field('numbers', 'WhatsApp numbers', '1,000 free service messages per number each month')}
      </div>
      <div className="flex flex-col rounded-lg bg-muted/40 p-5" aria-live="polite">
        <p className="text-sm text-muted-foreground">Estimated Meta charges per month</p>
        <p className="mt-1 text-4xl font-bold">{usd(r.total)}</p>
        <dl className="mt-5 space-y-2 text-sm">
          {rows.map(([k, val]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium">{usd(val)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-auto pt-5 text-xs text-muted-foreground">
          Meta’s list prices before volume discounts and taxes. Messages customers send you, and messages inside a
          Click-to-WhatsApp ad window, are not charged. Your OgaDesk plan is billed separately.
        </p>
      </div>
    </div>
  )
}
