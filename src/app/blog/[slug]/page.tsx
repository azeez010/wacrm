import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { cache } from 'react'
import { BlogShell } from '@/components/blog/blog-shell'
import { ARTICLE_CLASS, Breadcrumbs, Faq, fmtDate, PostCard, ShareLinks } from '@/components/blog/parts'
import { buttonVariants } from '@/components/ui/button'
import { cardImageUrl, fetchPost, imageUrl } from '@/lib/blog/api'
import { hardenLinks, injectHeadingIdsAndBuildToc, lazyImages } from '@/lib/blog/toc'
import { BRAND_NAME } from '@/lib/brand'
import { blogPostingJsonLd, breadcrumbJsonLd, faqJsonLd, graph, jsonLd, SITE_URL } from '@/lib/seo'
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
  if (r.kind === 'moved') permanentRedirect(`/blog/${r.slug}`)
  if (r.kind !== 'post') notFound()
  const { post: p, related, previous, next } = r
  const url = `${SITE_URL}/blog/${p.slug}`
  const siteHost = new URL(SITE_URL).host
  const { html, toc } = injectHeadingIdsAndBuildToc(p.body_html)
  const body = lazyImages(hardenLinks(html, siteHost))
  const cover = imageUrl(p.cover_image_url)
  const crumbs = [
    { name: 'Home', path: '/' },
    { name: 'Blog', path: '/blog' },
    ...(p.category && p.category_slug ? [{ name: p.category, path: `/blog/category/${p.category_slug}` }] : []),
    { name: p.title, path: `/blog/${p.slug}` },
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
          {p.category && p.category_slug && <Link href={`/blog/category/${p.category_slug}`} className="text-sm font-medium uppercase tracking-wide text-primary hover:underline">{p.category}</Link>}
          <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{p.title}</h1>
          {p.excerpt && <p className="mt-4 text-lg text-muted-foreground">{p.excerpt}</p>}
          <p className="mt-4 text-sm text-muted-foreground">
            {p.author && <>By <span className="font-medium text-foreground">{p.author}</span> · </>}
            <time dateTime={p.published_at}>{fmtDate(p.published_at)}</time>
            {updated && <> · Updated <time dateTime={p.updated_at}>{fmtDate(p.updated_at)}</time></>}
            {' · '}{p.reading_minutes} min read
          </p>
        </header>

        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt={p.cover_image_alt ?? ''} width={p.cover_image_width ?? 1200} height={p.cover_image_height ?? 630}
            fetchPriority="high" decoding="async" className="mt-8 h-auto w-full rounded-xl border object-cover" />
        )}

        {toc.length >= 3 && (
          <nav aria-label="Table of contents" className="mt-8 rounded-xl border bg-muted/40 p-5">
            <p className="text-sm font-semibold">On this page</p>
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
          <ul className="mt-10 flex flex-wrap gap-2" aria-label="Tags">
            {p.tags.map((t) => <li key={t} className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">#{t}</li>)}
          </ul>
        )}

        <div className="mt-8 border-t pt-6"><ShareLinks url={url} title={p.title} /></div>

        <aside className="mt-10 rounded-xl bg-primary p-6 text-primary-foreground sm:p-8">
          <p className="text-xl font-semibold">Run your WhatsApp sales and support from one inbox</p>
          <p className="mt-2 opacity-90">{BRAND_NAME} brings your team, contacts, broadcasts and automations together. Start free, no card needed.</p>
          <Link href="/signup" className={cn(buttonVariants({ variant: 'secondary' }), 'mt-5')}>Start free</Link>
        </aside>

        {(previous || next) && (
          <nav aria-label="More posts" className="mt-10 grid gap-4 sm:grid-cols-2">
            {previous ? <Link href={`/blog/${previous.slug}`} className="rounded-xl border p-4 hover:bg-accent"><span className="text-xs text-muted-foreground">Previous</span><span className="mt-1 block font-medium">{previous.title}</span></Link> : <span />}
            {next && <Link href={`/blog/${next.slug}`} className="rounded-xl border p-4 text-right hover:bg-accent"><span className="text-xs text-muted-foreground">Next</span><span className="mt-1 block font-medium">{next.title}</span></Link>}
          </nav>
        )}
      </article>

      {related.length > 0 && (
        <section aria-labelledby="related-heading" className="mt-16">
          <h2 id="related-heading" className="text-2xl font-semibold tracking-tight">Keep reading</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{related.map((rp) => <PostCard key={rp.slug} post={rp} />)}</div>
        </section>
      )}
    </BlogShell>
  )
}
