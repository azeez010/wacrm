'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { Flag } from '@/components/flag'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { COUNTRIES, POPULAR_COUNT, findCountry, type Country } from '@/lib/forms/countries'
import { cn } from '@/lib/utils'

type Variant = 'public' | 'app'

/** Match by name, ISO code or calling code ("nig", "ng", "234", "+234"). */
function filterCountries(query: string): Country[] {
  const q = query.trim().toLowerCase().replace(/^\+/, '')
  if (!q) return COUNTRIES
  return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.iso.toLowerCase() === q || c.cc.startsWith(q))
}

const THEME: Record<Variant, { trigger: string; panel: string; input: string; item: string; active: string; muted: string }> = {
  // Public form / chat widget: styled with the form's own --og-* variables, no portal.
  public: {
    trigger:
      'rounded-lg border border-[color:var(--og-border)] bg-[var(--og-input)] text-[color:var(--og-fg)] focus:border-[color:var(--og-muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--og-ring)]',
    panel: 'rounded-lg border border-[color:var(--og-border)] bg-[var(--og-input)] text-[color:var(--og-fg)] shadow-lg',
    input: 'border-[color:var(--og-border)] bg-transparent text-[color:var(--og-fg)] placeholder:text-[color:var(--og-muted)] focus:border-[color:var(--og-muted)]',
    item: 'text-[color:var(--og-fg)]',
    active: 'bg-[color:var(--og-border)]',
    muted: 'text-[color:var(--og-muted)]',
  },
  // Dashboard: regular app theme tokens.
  app: {
    trigger: 'rounded-lg border border-input bg-background text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
    panel: '',
    input: 'border-input bg-transparent placeholder:text-muted-foreground focus:border-ring',
    item: 'text-foreground',
    active: 'bg-muted',
    muted: 'text-muted-foreground',
  },
}

function Picker({
  variant,
  value,
  onSelect,
  placeholder,
}: {
  variant: Variant
  value: string
  onSelect: (iso: string) => void
  placeholder: string
}) {
  const th = THEME[variant]
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const results = useMemo(() => filterCountries(query), [query])
  const showDivider = !query.trim()

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const c = results[active]
      if (c) onSelect(c.iso)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className={cn('pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2', th.muted)} aria-hidden />
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          className={cn('h-9 w-full rounded-md border pl-8 pr-2 text-sm outline-none', th.input)}
        />
      </div>
      <ul ref={listRef} role="listbox" aria-label={placeholder} className="max-h-56 overflow-y-auto overscroll-contain">
        {results.map((c, i) => (
          <li
            key={c.iso}
            role="option"
            aria-selected={c.iso === value}
            data-active={i === active}
            onMouseMove={() => setActive(i)}
            onClick={() => onSelect(c.iso)}
            className={cn(
              'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm',
              th.item,
              i === active && th.active,
              showDivider && i === POPULAR_COUNT && 'mt-1 border-t border-current/10 pt-2',
            )}
          >
            <Flag iso={c.iso} />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            <span className={cn('tabular-nums', th.muted)}>+{c.cc}</span>
            {c.iso === value && <Check className="size-4 shrink-0" aria-hidden />}
          </li>
        ))}
        {results.length === 0 && <li className={cn('px-2 py-3 text-sm', th.muted)}>—</li>}
      </ul>
    </div>
  )
}

/**
 * Flag + calling-code button that opens a searchable list of every country.
 * `public` is self-contained (no portal) so it keeps the form theme and works
 * inside the embed iframes; `app` uses the shared Popover for dialogs.
 */
export function CountrySelect({
  value,
  onChange,
  variant = 'app',
  placeholder = 'Search country or code',
  className,
  id,
  disabled,
}: {
  value: string
  onChange: (iso: string) => void
  variant?: Variant
  placeholder?: string
  className?: string
  id?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const th = THEME[variant]
  const current = findCountry(value) ?? COUNTRIES[0]

  // Public variant has no portal, so close on outside click / Escape ourselves.
  useEffect(() => {
    if (variant !== 'public' || !open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [variant, open])

  const triggerCls = cn('inline-flex h-10 shrink-0 items-center gap-1.5 px-2.5 text-sm disabled:opacity-50', th.trigger, className)
  const triggerBody = (
    <>
      <Flag iso={current.iso} />
      <span className="tabular-nums">+{current.cc}</span>
      <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden />
    </>
  )
  const select = (iso: string) => {
    onChange(iso)
    setOpen(false)
  }

  if (variant === 'public') {
    return (
      <div ref={rootRef} className="relative shrink-0">
        <button
          type="button"
          id={id}
          aria-label={`${current.name} +${current.cc}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className={triggerCls}
        >
          {triggerBody}
        </button>
        {open && (
          <div className={cn('absolute left-0 top-full z-50 mt-1 w-[min(18rem,calc(100vw-2rem))] p-2', th.panel)}>
            <Picker variant="public" value={value} onSelect={select} placeholder={placeholder} />
          </div>
        )}
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        aria-label={`${current.name} +${current.cc}`}
        disabled={disabled}
        render={<button type="button" className={triggerCls} />}
      >
        {triggerBody}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <Picker variant="app" value={value} onSelect={select} placeholder={placeholder} />
      </PopoverContent>
    </Popover>
  )
}
