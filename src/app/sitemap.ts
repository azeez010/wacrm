import type { MetadataRoute } from 'next'
import { HREFLANG, LOCALES } from '@/i18n/locales'
import { routing } from '@/i18n/routing'
import { blogEntries } from '@/lib/blog/sitemap'
import { SITE_URL, localizedUrl } from '@/lib/seo'

// Built on each request (not at build time), so new blog posts appear without a redeploy.
export const dynamic = 'force-dynamic'

// Landing page in every language (with hreflang alternates), the English-only legal pages, and the blog:
// index, paginated pages, categories and every indexable post with its real last-modified date and image.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const languages: Record<string, string> = {}
  for (const l of LOCALES) languages[HREFLANG[l]] = localizedUrl(l)
  languages['x-default'] = localizedUrl(routing.defaultLocale)

  const landing = LOCALES.map((l) => ({
    url: localizedUrl(l),
    changeFrequency: 'weekly' as const,
    priority: l === routing.defaultLocale ? 1 : 0.9,
    alternates: { languages },
  }))
  const legal = ['/docs', '/partners', '/changelog', '/privacy', '/terms', '/data-deletion'].map((p) => ({
    url: `${SITE_URL}${p}`,
    changeFrequency: 'yearly' as const,
    priority: 0.3,
  }))
  return [...landing, ...legal, ...(await blogEntries())]
}
