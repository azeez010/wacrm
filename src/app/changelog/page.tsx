import type { Metadata } from 'next'
import Link from 'next/link'
import { BrandLogo } from '@/components/brand-logo'
import { BRAND_NAME } from '@/lib/brand'
import { CHANGELOG, type ChangeKind } from '@/lib/changelog'
import { cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: `Changelog | ${BRAND_NAME}`,
  description: `What's new in ${BRAND_NAME}: new features, improvements and fixes.`,
  robots: { index: true, follow: true },
}

const kindStyle: Record<ChangeKind, string> = {
  New: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  Improved: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  Fixed: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
}

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" aria-label={BRAND_NAME}>
          <BrandLogo className="text-lg" markClassName="h-9 w-9" />
        </Link>
        <Link href="/signup" className="text-sm underline">
          Try {BRAND_NAME} free
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
        <h1 className="mt-8 text-3xl font-bold tracking-tight sm:text-4xl">Changelog</h1>
        <p className="mt-2 text-muted-foreground">New features, improvements and fixes, newest first.</p>
        <div className="mt-10 space-y-10">
          {CHANGELOG.map((e) => (
            <section key={e.date} id={e.date} className="border-t pt-6">
              <h2 className="text-lg font-semibold">{fmt(e.date)}</h2>
              <ul className="mt-4 space-y-3">
                {e.changes.map((c, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className={cn('mt-0.5 shrink-0 rounded px-2 py-0.5 text-xs font-medium', kindStyle[c.kind])}>{c.kind}</span>
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  )
}
