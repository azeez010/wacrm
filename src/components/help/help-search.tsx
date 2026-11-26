'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'

export interface SearchItem {
  category: string
  title: string
  summary: string
  href: string
}

/** Instant, client-side search over the (small) article index. */
export function HelpSearch({ items, placeholder, empty }: { items: SearchItem[]; placeholder: string; empty: string }) {
  const [q, setQ] = useState('')
  const results = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) return []
    return items
      .filter((i) => words.every((w) => `${i.title} ${i.summary} ${i.category}`.toLowerCase().includes(w)))
      .slice(0, 8)
  }, [q, items])
  const active = q.trim().length > 0

  return (
    <div className="relative mx-auto mt-6 max-w-xl text-left">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-12 w-full rounded-xl border bg-background pl-10 pr-4 text-base shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      />
      {active && (
        <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-xl border bg-popover shadow-lg">
          {results.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{empty}</p>
          ) : (
            <ul>
              {results.map((r) => (
                <li key={r.href} className="border-b last:border-b-0">
                  <Link href={r.href} className="block px-4 py-3 hover:bg-accent">
                    <span className="block text-xs text-muted-foreground">{r.category}</span>
                    <span className="block font-medium">{r.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
