import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { BrandLogo } from '@/components/brand-logo'
import { footerColumns } from '@/components/footer-links'
import { isLocale } from '@/i18n/locales'
import { BRAND_NAME } from '@/lib/brand'
import { localizedPath } from '@/lib/seo'

/** The one footer for every public page (landing, blog, help, legal, partners). No auth lookup, so pages stay cacheable. */
export async function SiteFooter() {
  const raw = await getLocale()
  const locale = isLocale(raw) ? raw : 'en'
  const t = await getTranslations('Footer')
  const columns = footerColumns((path) => localizedPath(locale, path), locale)
  return (
    <footer className="border-t bg-muted/20">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href={localizedPath(locale, '/')} aria-label={BRAND_NAME}>
              <BrandLogo className="text-lg" markClassName="h-8 w-8" />
            </Link>
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">{t('description')}</p>
          </div>
          {columns.map((col) => (
            <nav key={col.title} aria-label={t(col.title)}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">{t(col.title)}</h2>
              <ul className="mt-4 space-y-2.5 text-sm">
                {col.links.map((l) => (
                  <li key={l.key}>
                    <Link href={l.href} className="text-muted-foreground hover:text-foreground">{t(l.key)}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>{t('rights', { year: new Date().getFullYear(), brand: BRAND_NAME })}</p>
          <p>{t('builtOn')}</p>
        </div>
        <p className="mt-3 text-xs text-muted-foreground/80">{t('trademark', { brand: BRAND_NAME })}</p>
      </div>
    </footer>
  )
}
