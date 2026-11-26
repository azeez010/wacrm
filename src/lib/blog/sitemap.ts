import type { MetadataRoute } from 'next'
import { fetchCategories, fetchSitemapPosts, imageUrl, PAGE_SIZE } from '@/lib/blog/api'
import { HREFLANG, LOCALES } from '@/i18n/locales'
import { routing } from '@/i18n/routing'
import { SITE_URL, localizedUrl } from '@/lib/seo'

const blogLanguages: Record<string, string> = {
  ...Object.fromEntries(LOCALES.map((l) => [HREFLANG[l], localizedUrl(l, '/blog')])),
  'x-default': localizedUrl(routing.defaultLocale, '/blog'),
}

export async function blogEntries(): Promise<MetadataRoute.Sitemap> {
  try {
    const [posts, categories] = await Promise.all([fetchSitemapPosts(), fetchCategories()])
    if (posts.length === 0) return [] // the blog stays out of the sitemap until it has a post
    const newest = new Date(posts[0]!.updated_at)
    const pages = Math.ceil(posts.length / PAGE_SIZE)
    return [
      // The blog home exists in every language (the chrome is translated); posts stay in their own language.
      ...LOCALES.map((l) => ({ url: localizedUrl(l, '/blog'), lastModified: newest, changeFrequency: 'daily' as const, priority: l === routing.defaultLocale ? 0.8 : 0.6, alternates: { languages: blogLanguages } })),
      ...Array.from({ length: Math.max(0, pages - 1) }, (_, i) => ({ url: `${SITE_URL}/blog/page/${i + 2}`, lastModified: newest, changeFrequency: 'daily' as const, priority: 0.4 })),
      ...categories.map((c) => ({ url: `${SITE_URL}/blog/category/${c.slug}`, lastModified: new Date(c.updated_at), changeFrequency: 'weekly' as const, priority: 0.5 })),
      ...posts.map((p) => {
        const img = imageUrl(p.cover_image_url)
        return { url: `${SITE_URL}/blog/${p.slug}`, lastModified: new Date(p.updated_at), changeFrequency: 'monthly' as const, priority: 0.7, ...(img ? { images: [img] } : {}) }
      }),
    ]
  } catch {
    // API hiccup: ship the static routes rather than a failed sitemap.
    return []
  }
}
