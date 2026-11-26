import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { BlogShell } from '@/components/blog/blog-shell'
import { ARTICLE_CLASS, Breadcrumbs, pageLocale } from '@/components/blog/parts'
import { BRAND_NAME, SUPPORT_EMAIL } from '@/lib/brand'
import { findArticle, getHelp } from '@/lib/help'
import { breadcrumbJsonLd, graph, jsonLd, localizedAlternates, localizedPath, localizedUrl } from '@/lib/seo'
import { cn } from '@/lib/utils'

type Props = { params: Promise<{ category: string; slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await pageLocale()
  const { category, slug } = await params
  const found = findArticle(locale, category, slug)
  if (!found) return { title: 'Not found', robots: { index: false, follow: false } }
  return {
    title: `${found.article.title} | ${BRAND_NAME}`,
    description: found.article.summary,
    robots: { index: true, follow: true },
    alternates: localizedAlternates(locale, `/help/${category}/${slug}`),
  }
}

export default async function HelpArticlePage({ params }: Props) {
  const locale = await pageLocale()
  const t = await getTranslations('Help')
  const tb = await getTranslations('Blog')
  const to = (path: string) => localizedPath(locale, path)
  const { category, slug } = await params
  const found = findArticle(locale, category, slug)
  if (!found) notFound()
  const { article, category: cat, previous, next } = found
  const crumbs = [
    { name: t('back'), path: to('/help') },
    { name: cat.title, path: to(`/help/${cat.id}`) },
    { name: article.title, path: to(`/help/${cat.id}/${article.slug}`) },
  ]
  const ld = graph(
    breadcrumbJsonLd(crumbs.map((c) => ({ ...c, path: c.path }))),
    { '@type': 'Article', headline: article.title, description: article.summary, url: localizedUrl(locale, `/help/${cat.id}/${article.slug}`), publisher: { '@type': 'Organization', name: BRAND_NAME } },
  )

  return (
    <BlogShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <Breadcrumbs items={crumbs.map((c, i) => ({ name: c.name, href: i < crumbs.length - 1 ? c.path : undefined }))} />
      <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav aria-label={t('back')} className="sticky top-6 space-y-5 text-sm">
            {getHelp(locale).map((c) => (
              <div key={c.id}>
                <Link href={to(`/help/${c.id}`)} className={cn('font-semibold', c.id === cat.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {c.emoji} {c.title}
                </Link>
                {c.id === cat.id && (
                  <ul className="mt-2 space-y-1 border-l pl-3">
                    {c.articles.map((a) => (
                      <li key={a.slug}>
                        <Link href={to(`/help/${c.id}/${a.slug}`)} className={a.slug === article.slug ? 'font-medium text-primary' : 'text-muted-foreground hover:text-foreground'}>
                          {a.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </nav>
        </aside>

        <article className="max-w-3xl">
          <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{article.title}</h1>
          {article.summary && <p className="mt-3 text-lg text-muted-foreground">{article.summary}</p>}
          {article.toc.length >= 3 && (
            <nav aria-label={tb('onThisPage')} className="mt-6 rounded-xl border bg-muted/40 p-4 text-sm">
              <p className="font-semibold">{tb('onThisPage')}</p>
              <ol className="mt-2 space-y-1">
                {article.toc.map((h) => (
                  <li key={h.id} className={h.level === 3 ? 'pl-4' : ''}>
                    <a href={`#${h.id}`} className="text-muted-foreground hover:text-foreground hover:underline">{h.text}</a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          {/* HTML is produced at build time from our own Markdown (scripts/build-help.mjs), which escapes raw HTML. */}
          <div className={cn('mt-8', ARTICLE_CLASS)} dangerouslySetInnerHTML={{ __html: article.html }} />

          {(previous || next) && (
            <nav aria-label={t('readNext')} className="mt-10 grid gap-4 sm:grid-cols-2">
              {previous ? <Link href={to(`/help/${cat.id}/${previous.slug}`)} className="rounded-xl border p-4 hover:bg-accent"><span className="text-xs text-muted-foreground">{tb('previous')}</span><span className="mt-1 block font-medium">{previous.title}</span></Link> : <span />}
              {next && <Link href={to(`/help/${cat.id}/${next.slug}`)} className="rounded-xl border p-4 text-right hover:bg-accent"><span className="text-xs text-muted-foreground">{tb('next')}</span><span className="mt-1 block font-medium">{next.title}</span></Link>}
            </nav>
          )}

          <p className="mt-10 rounded-xl bg-muted/50 p-5 text-sm">
            <span className="font-semibold">{t('helpful')}</span>{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary underline">{t('contact')}</a>
          </p>
        </article>
      </div>
    </BlogShell>
  )
}
