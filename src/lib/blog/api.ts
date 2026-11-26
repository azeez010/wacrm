// Server-side client for the public blog API (api.ogadesk.com/blog). Copied from tradersense-web
// src/app/blog/api.ts and hardened for SEO:
//  * only a real 404/410 becomes "not found"; any other failure throws, so a short API outage
//    shows an error page instead of telling search engines the post is gone;
//  * renamed posts come back as { kind: 'moved' } so the page can 301 to the new slug;
//  * responses are cached at Cloudflare's edge for 5 minutes (cf.cacheTtl), no Next cache needed.

export const BLOG_API_URL = (process.env.BLOG_API_URL || 'https://api.ogadesk.com').replace(/\/+$/, '')
export const PAGE_SIZE = 12

export type BlogCard = {
  slug: string
  title: string
  excerpt: string | null
  cover_image_url: string | null
  cover_image_alt: string | null
  cover_image_width: number | null
  cover_image_height: number | null
  author: string | null
  category: string | null
  category_slug: string | null
  tags: string[]
  reading_minutes: number
  published_at: string
  updated_at: string
}

export type BlogPost = BlogCard & {
  body_html: string
  meta_title: string | null
  meta_description: string | null
  keywords: string[]
  canonical_url: string | null
  noindex: boolean
  faq: { question: string; answer: string }[]
  word_count: number
}

export type Paged<T> = { data: T[]; count: number; page: number; limit: number; totalPages: number }
export type Category = { name: string; slug: string; posts: number; updated_at: string }

export class BlogApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

type CfInit = RequestInit & { cf?: { cacheTtl: number; cacheEverything: boolean } }

async function request(path: string): Promise<Response> {
  const init: CfInit = { headers: { accept: 'application/json' }, redirect: 'manual', cf: { cacheTtl: 300, cacheEverything: true } }
  return fetch(`${BLOG_API_URL}${path}`, init)
}

async function json<T>(path: string): Promise<T> {
  const res = await request(path)
  if (!res.ok) throw new BlogApiError(res.status, `Blog API ${path} failed (${res.status})`)
  return (await res.json()) as T
}

/** Absolute URL for an image the API returned (uploads are stored as /files/<id>.<ext>). */
export function imageUrl(u: string | null | undefined): string | null {
  if (!u) return null
  return u.startsWith('/') ? `${BLOG_API_URL}${u}` : u
}

/** The branded 1200x630 social card rendered by the API for a published post. */
export const cardImageUrl = (slug: string) => `${BLOG_API_URL}/card/blog/${encodeURIComponent(slug)}`

export function fetchPosts(opts: { page?: number; category?: string; limit?: number; lang?: string } = {}) {
  const q = new URLSearchParams({ page: String(opts.page ?? 1), limit: String(opts.limit ?? PAGE_SIZE) })
  if (opts.category) q.set('category', opts.category)
  // Not read by the API yet (posts are single-language); passed so per-post languages work once it is.
  if (opts.lang && opts.lang !== 'en') q.set('lang', opts.lang)
  return json<Paged<BlogCard>>(`/blog?${q.toString()}`)
}

export const fetchCategories = () => json<{ categories: Category[] }>('/blog/categories').then((r) => r.categories)
export const fetchSitemapPosts = () =>
  json<{ posts: { slug: string; title: string; cover_image_url: string | null; published_at: string; updated_at: string }[] }>('/blog/sitemap').then((r) => r.posts)
export const fetchFeedPosts = () =>
  json<{ posts: (Pick<BlogPost, 'slug' | 'title' | 'excerpt' | 'body_html' | 'cover_image_url' | 'author' | 'category' | 'tags' | 'published_at' | 'updated_at'>)[] }>('/blog/feed').then((r) => r.posts)

export type PostResult =
  | { kind: 'post'; post: BlogPost; related: BlogCard[]; previous: { slug: string; title: string } | null; next: { slug: string; title: string } | null }
  | { kind: 'moved'; slug: string }
  | { kind: 'gone' }
  | { kind: 'missing' }

export async function fetchPost(slug: string): Promise<PostResult> {
  const res = await request(`/blog/${encodeURIComponent(slug)}`)
  if (res.status === 301 || res.status === 308) {
    const body = (await res.json().catch(() => null)) as { redirectTo?: string } | null
    const to = body?.redirectTo ?? res.headers.get('location')?.split('/').pop()
    if (to) return { kind: 'moved', slug: to }
  }
  if (res.status === 410) return { kind: 'gone' }
  if (res.status === 404) return { kind: 'missing' }
  if (!res.ok) throw new BlogApiError(res.status, `Blog API post failed (${res.status})`)
  const body = (await res.json()) as Omit<Extract<PostResult, { kind: 'post' }>, 'kind'>
  return { kind: 'post', ...body }
}
