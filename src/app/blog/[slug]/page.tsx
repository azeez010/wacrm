import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { cache } from 'react'
import { getTranslations } from 'next-intl/server'
import { BlogShell } from '@/components/blog/blog-shell'
import { ARTICLE_CLASS, Breadcrumbs, Faq, fmtDate, pageLocale, PostCard, ShareLinks } from '@/components/blog/parts'
import { buttonVariants } from '@/components/ui/button'
import { cardImageUrl, fetchPost, imageUrl } from '@/lib/blog/api'
import { hardenLinks, injectHeadingIdsAndBuildToc, lazyImages } from '@/lib/blog/toc'
import { BRAND_NAME } from '@/lib/brand'
import { blogPostingJsonLd, breadcrumbJsonLd, faqJsonLd, graph, jsonLd, localizedPath, SITE_URL } from '@/lib/seo'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'
type Props = { params: Promise<{ slug: string }> }

// A post edited before its (scheduled) publish time would otherwise claim to be modified before it was published.
const lastModified = (published: string, updated: string) => (new Date(updated) > new Date(published) ? updated : published)

// One API call per request, shared by generateMetadata and the page.
const load = cache(async (slug: string) => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) return { kind: 'missing' as const }
  return fetchPost(slug)
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const r = await load(slug)
  if (r.kind !== 'post') return { title: 'Post not found', robots: { index: false, follow: false } }
  const p = r.post
  const url = `${SITE_URL}/blog/${p.slug}`
  const modified = lastModified(p.published_at, p.updated_at)
  const title = p.meta_title || p.title
  const description = p.meta_description || p.excerpt || undefined
  const card = cardImageUrl(p.slug)
  return {
    title,
    description,
    keywords: p.keywords.length ? p.keywords : undefined,
    authors: p.author ? [{ name: p.author }] : undefined,
    category: p.category ?? undefined,
    robots: p.noindex ? { index: false, follow: true } : { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
    alternates: { canonical: p.canonical_url || url, types: { 'application/rss+xml': [{ url: `${SITE_URL}/blog/feed.xml`, title: `${BRAND_NAME} Blog` }] } },
    openGraph: {
      type: 'article',
      siteName: BRAND_NAME,
      locale: 'en_GB',
      url,
      title,
      description,
      publishedTime: p.published_at,
      modifiedTime: modified,
      authors: p.author ? [p.author] : undefined,
      section: p.category ?? undefined,
      tags: p.tags,
      images: [{ url: card, width: 1200, height: 630, alt: p.title }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [card] },
  }
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params
  const r = await load(slug)
  const locale = await pageLocale()
  const t = await getTranslations('Blog')
  const to = (path: string) => localizedPath(locale, path)
  if (r.kind === 'moved') permanentRedirect(to(`/blog/${r.slug}`))
  if (r.kind !== 'post') notFound()
  const { post: p, related, previous, next } = r
  const url = `${SITE_URL}/blog/${p.slug}`
  const siteHost = new URL(SITE_URL).host
  const { html, toc } = injectHeadingIdsAndBuildToc(p.body_html)
  const body = lazyImages(hardenLinks(html, siteHost))
  const cover = imageUrl(p.cover_image_url)
  const crumbs = [
    { name: t('home'), path: to('/') },
    { name: t('blog'), path: to('/blog') },
    ...(p.category && p.category_slug ? [{ name: p.category, path: to(`/blog/category/${p.category_slug}`) }] : []),
    { name: p.title, path: to(`/blog/${p.slug}`) },
  ]
  const updated = new Date(p.updated_at).getTime() - new Date(p.published_at).getTime() > 86_400_000
  const ld = graph(
    blogPostingJsonLd({
      slug: p.slug, title: p.title, description: p.meta_description || p.excerpt, images: [cardImageUrl(p.slug), ...(cover ? [cover] : [])],
      publishedAt: p.published_at, updatedAt: lastModified(p.published_at, p.updated_at), author: p.author, category: p.category, tags: p.tags, keywords: p.keywords,
      wordCount: p.word_count, canonical: p.canonical_url || url,
    }, BRAND_NAME),
    breadcrumbJsonLd(crumbs),
    ...(p.faq.length ? [faqJsonLd(p.faq)] : []),
  )

  return (
    <BlogShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <Breadcrumbs items={crumbs.map((c, i) => ({ name: c.name, href: i < crumbs.length - 1 ? c.path : undefined }))} />
      <article className="mx-auto max-w-3xl">
        <header className="pt-4">
          {p.category && p.category_slug && <Link href={to(`/blog/category/${p.category_slug}`)} className="text-sm font-medium uppercase tracking-wide text-primary hover:underline">{p.category}</Link>}
          <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{p.title}</h1>
          {p.excerpt && <p className="mt-4 text-lg text-muted-foreground">{p.excerpt}</p>}
          <p className="mt-4 text-sm text-muted-foreground">
            {p.author && <>{t('by')} <span className="font-medium text-foreground">{p.author}</span> · </>}
            <time dateTime={p.published_at}>{fmtDate(p.published_at, locale)}</time>
            {updated && <> · {t('updated')} <time dateTime={p.updated_at}>{fmtDate(p.updated_at, locale)}</time></>}
            {' · '}{t('minRead', { n: p.reading_minutes })}
          </p>
        </header>

        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt={p.cover_image_alt ?? ''} width={p.cover_image_width ?? 1200} height={p.cover_image_height ?? 630}
            fetchPriority="high" decoding="async" className="mt-8 h-auto w-full rounded-xl border object-cover" />
        )}

        {toc.length >= 3 && (
          <nav aria-label={t('onThisPage')} className="mt-8 rounded-xl border bg-muted/40 p-5">
            <p className="text-sm font-semibold">{t('onThisPage')}</p>
            <ol className="mt-3 space-y-1.5 text-sm">
              {toc.map((t) => (
                <li key={t.id} className={t.level === 3 ? 'pl-4' : ''}><a href={`#${t.id}`} className="text-muted-foreground hover:text-foreground hover:underline">{t.text}</a></li>
              ))}
            </ol>
          </nav>
        )}

        {/* Body HTML is sanitised by the API when saved (allowlist; no scripts, handlers or iframes). */}
        <div className={cn('mt-10', ARTICLE_CLASS)} dangerouslySetInnerHTML={{ __html: body }} />

        <Faq items={p.faq} />

        {p.tags.length > 0 && (
          <ul className="mt-10 flex flex-wrap gap-2" aria-label={t('tags')}>
            {p.tags.map((t) => <li key={t} className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">#{t}</li>)}
          </ul>
        )}

        <div className="mt-8 border-t pt-6"><ShareLinks url={url} title={p.title} /></div>

        <aside className="mt-10 rounded-xl bg-primary p-6 text-primary-foreground sm:p-8">
          <p className="text-xl font-semibold">{t('ctaTitle')}</p>
          <p className="mt-2 opacity-90">{t('ctaBody', { brand: BRAND_NAME })}</p>
          <Link href="/signup" className={cn(buttonVariants({ variant: 'secondary' }), 'mt-5')}>{t('ctaButton')}</Link>
        </aside>

        {(previous || next) && (
          <nav aria-label={t('keepReading')} className="mt-10 grid gap-4 sm:grid-cols-2">
            {previous ? <Link href={to(`/blog/${previous.slug}`)} className="rounded-xl border p-4 hover:bg-accent"><span className="text-xs text-muted-foreground">{t('previous')}</span><span className="mt-1 block font-medium">{previous.title}</span></Link> : <span />}
            {next && <Link href={to(`/blog/${next.slug}`)} className="rounded-xl border p-4 text-right hover:bg-accent"><span className="text-xs text-muted-foreground">{t('next')}</span><span className="mt-1 block font-medium">{next.title}</span></Link>}
          </nav>
        )}
      </article>

      {related.length > 0 && (
        <section aria-labelledby="related-heading" className="mt-16">
          <h2 id="related-heading" className="text-2xl font-semibold tracking-tight">{t('keepReading')}</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{related.map((rp) => <PostCard key={rp.slug} post={rp} />)}</div>
        </section>
      )}
    </BlogShell>
  )
}
