'use client'

import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/**
 * Pick the currency prices are shown in. Stores the choice in a cookie, then
 * reloads so server-rendered prices follow. Hidden when conversion is off or
 * there is nothing to choose.
 */
export function CurrencySwitcher({ current, options, className }: { current: string; options: string[]; className?: string }) {
  const [busy, setBusy] = useState(false)
  if (options.length < 2) return null

  async function choose(code: string) {
    if (code === current || busy) return
    setBusy(true)
    const res = await fetch('/api/currency', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currency: code }) })
    if (res.ok) window.location.reload()
    else setBusy(false)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn('inline-flex h-9 items-center gap-1 rounded-lg border border-input bg-background px-3 text-sm font-medium hover:bg-muted', className)}
        aria-label="Currency"
        disabled={busy}
      >
        {current}
        <ChevronDown className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        {options.map((code) => (
          <DropdownMenuItem key={code} onClick={() => void choose(code)} className="justify-between gap-4">
            {code}
            {code === current && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
