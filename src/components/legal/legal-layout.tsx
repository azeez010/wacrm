import Link from 'next/link'
import type { ReactNode } from 'react'
import { BrandLogo } from '@/components/brand-logo'
import { BRAND_NAME, LEGAL_LAST_UPDATED } from '@/lib/brand'

/** Shared chrome for the public legal pages (privacy, terms, data deletion). */
export function LegalLayout({
  title,
  intro,
  children,
}: {
  title: string
  intro?: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" aria-label={BRAND_NAME}>
          <BrandLogo className="text-lg" markClassName="h-9 w-9" />
        </Link>
        <nav className="flex gap-4 text-sm text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
          <Link href="/data-deletion" className="hover:text-foreground">Data deletion</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {LEGAL_LAST_UPDATED}</p>
        {intro && <p className="mt-6 text-muted-foreground">{intro}</p>}
        <div className="mt-8 space-y-8">{children}</div>
      </main>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}
