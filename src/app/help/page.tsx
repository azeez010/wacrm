import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { BlogShell } from '@/components/blog/blog-shell'
import { pageLocale } from '@/components/blog/parts'
import { HelpSearch } from '@/components/help/help-search'
import { HREFLANG } from '@/i18n/locales'
import { BRAND_NAME } from '@/lib/brand'
import { getHelp } from '@/lib/help'
import { localizedAlternates, localizedPath, localizedUrl } from '@/lib/seo'

export async function generateMetadata(): Promise<Metadata> {
  const locale = await pageLocale()
  const t = await getTranslations('Help')
  const title = `${t('metaTitle')} | ${BRAND_NAME}`
  return {
    title: { absolute: title },
    description: t('metaDescription', { brand: BRAND_NAME }),
    robots: { index: true, follow: true },
    alternates: localizedAlternates(locale, '/help'),
    openGraph: { type: 'website', siteName: BRAND_NAME, title, url: localizedUrl(locale, '/help'), locale: HREFLANG[locale].replace('-', '_') },
  }
}

export default async function HelpHome() {
  const locale = await pageLocale()
  const t = await getTranslations('Help')
  const to = (path: string) => localizedPath(locale, path)
  const cats = getHelp(locale)
  const items = cats.flatMap((c) => c.articles.map((a) => ({ category: c.title, title: a.title, summary: a.summary, href: to(`/help/${c.id}/${a.slug}`) })))
  const popular = cats.flatMap((c) => c.articles.slice(0, 1).map((a) => ({ c, a }))).slice(0, 6)

  return (
    <BlogShell>
      <section className="py-12 text-center sm:py-16">
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">{t('heading')}</h1>
        <p className="mt-3 text-muted-foreground">{t('sub')}</p>
        <HelpSearch items={items} placeholder={t('search')} empty={t('noResults')} />
      </section>

      <section aria-labelledby="browse">
        <h2 id="browse" className="mb-5 text-xl font-semibold">{t('browse')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cats.map((c) => (
            <Link key={c.id} href={to(`/help/${c.id}`)} className="group flex flex-col rounded-xl border bg-card p-5 transition-shadow hover:shadow-md">
              <span className="text-3xl" aria-hidden>{c.emoji}</span>
              <h3 className="mt-3 text-lg font-semibold">{c.title}</h3>
              <p className="mt-1 flex-1 text-sm text-muted-foreground">{c.description}</p>
              <p className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('articles', { n: c.articles.length })}</span>
                <span className="font-medium text-primary group-hover:underline">{t('more')} →</span>
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="popular" className="mt-14">
        <h2 id="popular" className="mb-4 text-xl font-semibold">{t('popular')}</h2>
        <ul className="divide-y rounded-xl border">
          {popular.map(({ c, a }) => (
            <li key={`${c.id}/${a.slug}`}>
              <Link href={to(`/help/${c.id}/${a.slug}`)} className="block px-5 py-4 hover:bg-accent">
                <span className="block text-xs text-muted-foreground">{c.title}</span>
                <span className="block font-medium">{a.title}</span>
                <span className="block text-sm text-muted-foreground">{a.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </BlogShell>
  )
}
