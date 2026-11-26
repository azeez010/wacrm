import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { BlogShell } from '@/components/blog/blog-shell'
import { Breadcrumbs, Pagination, pageLocale, PostGrid } from '@/components/blog/parts'
import { HREFLANG } from '@/i18n/locales'
import { cardImageUrl, fetchCategories, fetchPosts, imageUrl, type Category } from '@/lib/blog/api'
import { BRAND_NAME } from '@/lib/brand'
import { blogCollectionJsonLd, breadcrumbJsonLd, graph, jsonLd, localizedAlternates, localizedPath, localizedUrl, SITE_URL } from '@/lib/seo'

export { BLOG_DESCRIPTION_RSS as BLOG_DESCRIPTION } from '@/lib/blog/rss'
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
  const locale = await pageLocale()
  const t = await getTranslations('Blog')
  const cat = categorySlug ? await categoryFor(categorySlug) : null
  const base = cat ? `/blog/category/${cat.slug}` : '/blog'
  const path = page === 1 ? base : `${base}/page/${page}`
  const res = await fetchPosts({ page, category: cat?.slug, lang: locale })
  const name = cat ? `${cat.name} ${t('categorySuffix')}` : t('blog')
  const description = cat ? t('categoryIntro', { name: cat.name }) : t('description', { brand: BRAND_NAME })
  const title = page > 1 ? `${name} (${t('page', { n: page })})` : name
  const first = res.data[0]
  const image = first ? imageUrl(first.cover_image_url) ?? cardImageUrl(first.slug) : `${SITE_URL}/android-chrome-512x512.png`
  return {
    title,
    description,
    // An empty blog is kept out of the index until the first post exists.
    robots: res.count === 0 ? { index: false, follow: true } : { index: true, follow: true, 'max-image-preview': 'large' },
    alternates: { ...localizedAlternates(locale, path), types: FEED },
    openGraph: { type: 'website', siteName: BRAND_NAME, title: `${title} - ${BRAND_NAME}`, description, url: localizedUrl(locale, path), locale: HREFLANG[locale].replace('-', '_'), images: [{ url: image }] },
    twitter: { card: 'summary_large_image', title: `${title} - ${BRAND_NAME}`, description, images: [image] },
  }
}

export async function ListView({ page, categorySlug }: { page: number; categorySlug?: string }) {
  const locale = await pageLocale()
  const t = await getTranslations('Blog')
  const to = (path: string) => localizedPath(locale, path)
  const cat = categorySlug ? await categoryFor(categorySlug) : null
  const base = cat ? `/blog/category/${cat.slug}` : '/blog'
  const [res, categories] = await Promise.all([fetchPosts({ page, category: cat?.slug, lang: locale }), fetchCategories()])
  if (page > 1 && page > res.totalPages) notFound()
  const path = page === 1 ? base : `${base}/page/${page}`
  const crumbs = [{ name: t('home'), path: to('/') }, { name: t('blog'), path: to('/blog') }, ...(cat ? [{ name: cat.name, path: to(base) }] : [])]
  const heading = cat ? cat.name : t('title', { brand: BRAND_NAME })
  const ld = graph(
    breadcrumbJsonLd(crumbs),
    blogCollectionJsonLd({ name: heading, description: cat ? `${cat.name} ${t('categorySuffix')}` : t('description', { brand: BRAND_NAME }), url: localizedUrl(locale, path), posts: res.data.map((p) => ({ title: p.title, url: localizedUrl(locale, `/blog/${p.slug}`) })) }, BRAND_NAME),
  )

  return (
    <BlogShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <Breadcrumbs items={crumbs.map((c, i) => ({ name: c.name, href: i < crumbs.length - 1 ? c.path : undefined }))} />
      <header className="pb-8 pt-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{heading}{page > 1 && <span className="text-muted-foreground"> · {t('page', { n: page })}</span>}</h1>
        <p className="mt-3 max-w-2xl text-lg text-muted-foreground">{cat ? t('categoryIntro', { name: cat.name }) : t('description', { brand: BRAND_NAME })}</p>
        {categories.length > 0 && (
          <nav aria-label={t('categories')} className="mt-6 flex flex-wrap gap-2 text-sm">
            <Link href={to('/blog')} aria-current={!cat ? 'page' : undefined} className={!cat ? 'rounded-full bg-primary px-3 py-1 text-primary-foreground' : 'rounded-full border px-3 py-1 hover:bg-accent'}>{t('all')}</Link>
            {categories.map((c) => (
              <Link key={c.slug} href={to(`/blog/category/${c.slug}`)} aria-current={cat?.slug === c.slug ? 'page' : undefined}
                className={cat?.slug === c.slug ? 'rounded-full bg-primary px-3 py-1 text-primary-foreground' : 'rounded-full border px-3 py-1 hover:bg-accent'}>
                {c.name} <span className="opacity-70">({c.posts})</span>
              </Link>
            ))}
          </nav>
        )}
      </header>
      {res.data.length === 0
        ? <p className="rounded-xl border p-10 text-center text-muted-foreground">{t('noPosts')}</p>
        : <PostGrid posts={res.data} />}
      <Pagination page={page} totalPages={res.totalPages} base={base} />
    </BlogShell>
  )
}
