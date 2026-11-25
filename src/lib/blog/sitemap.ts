import type { MetadataRoute } from 'next'
import { fetchCategories, fetchSitemapPosts, imageUrl, PAGE_SIZE } from '@/lib/blog/api'
import { SITE_URL } from '@/lib/seo'

export async function blogEntries(): Promise<MetadataRoute.Sitemap> {
  try {
    const [posts, categories] = await Promise.all([fetchSitemapPosts(), fetchCategories()])
    if (posts.length === 0) return [] // the blog stays out of the sitemap until it has a post
    const newest = new Date(posts[0]!.updated_at)
    const pages = Math.ceil(posts.length / PAGE_SIZE)
    return [
      { url: `${SITE_URL}/blog`, lastModified: newest, changeFrequency: 'daily', priority: 0.8 },
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
