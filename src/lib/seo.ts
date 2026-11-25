import type { Metadata } from 'next'
import { HREFLANG, LOCALES, type Locale } from '@/i18n/locales'
import { routing } from '@/i18n/routing'

/** Public origin used for canonical URLs, hreflang and the sitemap. */
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://ogadesk.com').replace(/\/+$/, '')

/** Hosts that are only the in-process stand-in for the MCP -> REST hop; never a real address to give people. */
const INTERNAL_HOSTS = new Set(['mcp.internal'])

/**
 * The origin to put in links we hand out (form links, embed snippets).
 * A configured domain beats the request's Host header: Host differs between our domains
 * and workers.dev, can be spoofed, and is a fake internal name when a call comes through MCP.
 */
export function publicOrigin(request?: Request, env: Record<string, string | undefined> = process.env): string {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  if (request) {
    try {
      const u = new URL(request.url)
      if (!INTERNAL_HOSTS.has(u.hostname)) return u.origin
    } catch {
      // fall through
    }
  }
  return SITE_URL
}

/**
 * Organization + WebSite structured data (JSON-LD) so Google can pick our logo and name for brand results.
 * The logo is the square 512px PNG. The result is a JSON string safe to inline in a <script> (no "<").
 */
export function organizationJsonLd(name: string, siteUrl: string = SITE_URL): string {
  const doc = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${siteUrl}/#organization`, name, url: siteUrl, logo: { '@type': 'ImageObject', url: `${siteUrl}/android-chrome-512x512.png`, width: 512, height: 512 } },
      { '@type': 'WebSite', '@id': `${siteUrl}/#website`, name, url: siteUrl, publisher: { '@id': `${siteUrl}/#organization` } },
    ],
  }
  return JSON.stringify(doc).replace(/</g, '\\u003c')
}

/** Path of a localized public page: the default language is unprefixed. */
export function localizedPath(locale: Locale, path = '/'): string {
  if (locale === routing.defaultLocale) return path
  return path === '/' ? `/${locale}` : `/${locale}${path}`
}

export function localizedUrl(locale: Locale, path = '/'): string {
  return `${SITE_URL}${localizedPath(locale, path)}`
}

/** canonical + hreflang (incl. x-default) for a localized public page. */
export function localizedAlternates(locale: Locale, path = '/'): NonNullable<Metadata['alternates']> {
  const languages: Record<string, string> = {}
  for (const l of LOCALES) languages[HREFLANG[l]] = localizedUrl(l, path)
  languages['x-default'] = localizedUrl(routing.defaultLocale, path)
  return { canonical: localizedUrl(locale, path), languages }
}

/** Serialises structured data for a <script type="application/ld+json"> (no "<", so it cannot close the tag). */
export function jsonLd(doc: unknown): string {
  return JSON.stringify(doc).replace(/</g, '\\u003c')
}

export type Crumb = { name: string; path: string }

export function breadcrumbJsonLd(crumbs: Crumb[], siteUrl: string = SITE_URL) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${siteUrl}${c.path}` })),
  }
}

export type BlogPostingInput = {
  slug: string
  title: string
  description: string | null
  images: string[]
  publishedAt: string
  updatedAt: string
  author: string | null
  category: string | null
  tags: string[]
  keywords: string[]
  wordCount: number
  canonical: string
}

/**
 * BlogPosting with the fields Google uses for article rich results: headline, images, both dates,
 * author (a Person when named, else the organisation) and the publisher with its logo.
 */
export function blogPostingJsonLd(p: BlogPostingInput, brand: string, siteUrl: string = SITE_URL) {
  const org = { '@type': 'Organization', '@id': `${siteUrl}/#organization`, name: brand, url: siteUrl, logo: { '@type': 'ImageObject', url: `${siteUrl}/android-chrome-512x512.png`, width: 512, height: 512 } }
  return {
    '@type': 'BlogPosting',
    '@id': `${p.canonical}#article`,
    mainEntityOfPage: { '@type': 'WebPage', '@id': p.canonical },
    url: p.canonical,
    headline: p.title.slice(0, 110),
    ...(p.description ? { description: p.description } : {}),
    image: p.images,
    datePublished: p.publishedAt,
    dateModified: p.updatedAt,
    author: p.author ? { '@type': 'Person', name: p.author } : { '@id': `${siteUrl}/#organization` },
    publisher: org,
    inLanguage: 'en',
    ...(p.category ? { articleSection: p.category } : {}),
    ...(p.tags.length || p.keywords.length ? { keywords: [...new Set([...p.keywords, ...p.tags])].join(', ') } : {}),
    wordCount: p.wordCount,
    isPartOf: { '@type': 'Blog', '@id': `${siteUrl}/blog#blog` },
  }
}

export function faqJsonLd(faq: { question: string; answer: string }[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
  }
}

/** The blog (or a category of it) as a collection listing its posts. */
export function blogCollectionJsonLd(opts: { name: string; description: string; url: string; posts: { title: string; url: string }[] }, brand: string, siteUrl: string = SITE_URL) {
  return {
    '@type': 'CollectionPage',
    '@id': `${opts.url}#page`,
    url: opts.url,
    name: opts.name,
    description: opts.description,
    isPartOf: { '@type': 'Blog', '@id': `${siteUrl}/blog#blog`, name: `${brand} Blog`, url: `${siteUrl}/blog`, publisher: { '@id': `${siteUrl}/#organization` } },
    mainEntity: { '@type': 'ItemList', itemListElement: opts.posts.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: p.url, name: p.title })) },
  }
}

/** Wraps several nodes into one @graph document. */
export const graph = (...nodes: object[]) => ({ '@context': 'https://schema.org', '@graph': nodes })
