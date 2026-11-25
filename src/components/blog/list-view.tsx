import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BlogShell } from '@/components/blog/blog-shell'
import { Breadcrumbs, Pagination, PostGrid } from '@/components/blog/parts'
import { cardImageUrl, fetchCategories, fetchPosts, imageUrl, type Category } from '@/lib/blog/api'
import { BRAND_NAME } from '@/lib/brand'
import { blogCollectionJsonLd, breadcrumbJsonLd, graph, jsonLd, SITE_URL } from '@/lib/seo'

export { BLOG_DESCRIPTION_RSS as BLOG_DESCRIPTION } from '@/lib/blog/rss'
import { BLOG_DESCRIPTION_RSS as BLOG_DESCRIPTION } from '@/lib/blog/rss'
const FEED = { 'application/rss+xml': [{ url: `${SITE_URL}/blog/feed.xml`, title: `${BRAND_NAME} Blog` }] }

/** Parses the [n] page segment: page 1 lives at the base URL, so /page/1 and junk are 404s. */
export function parsePage(n: string): number {
  if (!/^\d{1,4}$/.test(n)) notFound()
  const page = Number(n)
  if (page < 2) notFound()
  return page
}

async function categoryFor(slug: string): Promise<Category> {
  const cats = await fetchCategories()
  const cat = cats.find((c) => c.slug === slug)
  if (!cat) notFound()
  return cat
}

export async function listMetadata({ page, categorySlug }: { page: number; categorySlug?: string }): Promise<Metadata> {
  const cat = categorySlug ? await categoryFor(categorySlug) : null
  const base = cat ? `/blog/category/${cat.slug}` : '/blog'
  const path = page === 1 ? base : `${base}/page/${page}`
  const res = await fetchPosts({ page, category: cat?.slug })
  const name = cat ? `${cat.name} articles` : 'Blog'
  const description = cat ? `${cat.name}: guides and articles from the ${BRAND_NAME} team.` : BLOG_DESCRIPTION
  const title = page > 1 ? `${name} (page ${page})` : name
  const first = res.data[0]
  const image = first ? imageUrl(first.cover_image_url) ?? cardImageUrl(first.slug) : `${SITE_URL}/android-chrome-512x512.png`
  return {
    title,
    description,
    // An empty blog is kept out of the index until the first post exists.
    robots: res.count === 0 ? { index: false, follow: true } : { index: true, follow: true, 'max-image-preview': 'large' },
    alternates: { canonical: `${SITE_URL}${path}`, types: FEED },
    openGraph: { type: 'website', siteName: BRAND_NAME, title: `${title} - ${BRAND_NAME}`, description, url: `${SITE_URL}${path}`, locale: 'en_GB', images: [{ url: image }] },
    twitter: { card: 'summary_large_image', title: `${title} - ${BRAND_NAME}`, description, images: [image] },
  }
}

export async function ListView({ page, categorySlug }: { page: number; categorySlug?: string }) {
  const cat = categorySlug ? await categoryFor(categorySlug) : null
  const base = cat ? `/blog/category/${cat.slug}` : '/blog'
  const [res, categories] = await Promise.all([fetchPosts({ page, category: cat?.slug }), fetchCategories()])
  if (page > 1 && page > res.totalPages) notFound()
  const path = page === 1 ? base : `${base}/page/${page}`
  const crumbs = [{ name: 'Home', path: '/' }, { name: 'Blog', path: '/blog' }, ...(cat ? [{ name: cat.name, path: base }] : [])]
  const heading = cat ? cat.name : `${BRAND_NAME} Blog`
  const ld = graph(
    breadcrumbJsonLd(crumbs),
    blogCollectionJsonLd({ name: heading, description: cat ? `${cat.name} articles` : BLOG_DESCRIPTION, url: `${SITE_URL}${path}`, posts: res.data.map((p) => ({ title: p.title, url: `${SITE_URL}/blog/${p.slug}` })) }, BRAND_NAME),
  )

  return (
    <BlogShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <Breadcrumbs items={crumbs.map((c, i) => ({ name: c.name, href: i < crumbs.length - 1 ? c.path : undefined }))} />
      <header className="pb-8 pt-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{heading}{page > 1 && <span className="text-muted-foreground"> · page {page}</span>}</h1>
        <p className="mt-3 max-w-2xl text-lg text-muted-foreground">{cat ? `Everything we've written about ${cat.name.toLowerCase()}.` : BLOG_DESCRIPTION}</p>
        {categories.length > 0 && (
          <nav aria-label="Categories" className="mt-6 flex flex-wrap gap-2 text-sm">
            <Link href="/blog" aria-current={!cat ? 'page' : undefined} className={!cat ? 'rounded-full bg-primary px-3 py-1 text-primary-foreground' : 'rounded-full border px-3 py-1 hover:bg-accent'}>All</Link>
            {categories.map((c) => (
              <Link key={c.slug} href={`/blog/category/${c.slug}`} aria-current={cat?.slug === c.slug ? 'page' : undefined}
                className={cat?.slug === c.slug ? 'rounded-full bg-primary px-3 py-1 text-primary-foreground' : 'rounded-full border px-3 py-1 hover:bg-accent'}>
                {c.name} <span className="opacity-70">({c.posts})</span>
              </Link>
            ))}
          </nav>
        )}
      </header>
      {res.data.length === 0
        ? <p className="rounded-xl border p-10 text-center text-muted-foreground">No posts yet. Check back soon.</p>
        : <PostGrid posts={res.data} />}
      <Pagination page={page} totalPages={res.totalPages} base={base} />
    </BlogShell>
  )
}
