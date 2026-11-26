import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { BlogShell } from '@/components/blog/blog-shell'
import { pageLocale } from '@/components/blog/parts'
import { HREFLANG } from '@/i18n/locales'
import { BRAND_NAME } from '@/lib/brand'
import { CHANGELOG, changeText, type ChangeKind } from '@/lib/changelog'
import { localizedAlternates, localizedUrl } from '@/lib/seo'
import { cn } from '@/lib/utils'

export async function generateMetadata(): Promise<Metadata> {
  const locale = await pageLocale()
  const t = await getTranslations('Changelog')
  const title = `${t('title')} | ${BRAND_NAME}`
  return {
    title: { absolute: title },
    description: t('description', { brand: BRAND_NAME }),
    robots: { index: true, follow: true },
    alternates: localizedAlternates(locale, '/changelog'),
    openGraph: { type: 'website', siteName: BRAND_NAME, title, url: localizedUrl(locale, '/changelog'), locale: HREFLANG[locale].replace('-', '_') },
  }
}

const kindStyle: Record<ChangeKind, string> = {
  New: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  Improved: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  Fixed: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
}

export default async function ChangelogPage() {
  const locale = await pageLocale()
  const t = await getTranslations('Changelog')
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-GB' : locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  return (
    <BlogShell>
      <div className="mx-auto max-w-3xl">
        <h1 className="mt-8 text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('description', { brand: BRAND_NAME })}</p>
        <div className="mt-10 space-y-10">
          {CHANGELOG.map((e) => (
            <section key={e.date} id={e.date} className="border-t pt-6">
              <h2 className="text-lg font-semibold">{fmt(e.date)}</h2>
              <ul className="mt-4 space-y-3">
                {e.changes.map((c, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className={cn('mt-0.5 shrink-0 rounded px-2 py-0.5 text-xs font-medium', kindStyle[c.kind])}>{t(c.kind)}</span>
                    <span>{changeText(c.text, locale)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-12 text-sm">
          <Link href="/signup" className="underline">{t('tryFree', { brand: BRAND_NAME })}</Link>
        </p>
      </div>
    </BlogShell>
  )
}
