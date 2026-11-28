import type { MetadataRoute } from 'next'
import { HREFLANG, LOCALES } from '@/i18n/locales'
import { routing } from '@/i18n/routing'
import { blogEntries } from '@/lib/blog/sitemap'
import { getHelp } from '@/lib/help'
import { MARKETING_PAGES } from '@/lib/marketing/pages'
import { pagePath } from '@/lib/marketing/route'
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
  const legal = ['/docs', '/partners', '/privacy', '/terms', '/data-deletion', '/anti-spam'].map((p) => ({
    url: `${SITE_URL}${p}`,
    changeFrequency: 'yearly' as const,
    priority: 0.3,
  }))
  const changelog = LOCALES.map((l) => ({
    url: localizedUrl(l, '/changelog'),
    changeFrequency: 'weekly' as const,
    priority: 0.4,
    alternates: { languages: Object.fromEntries([...LOCALES.map((x) => [HREFLANG[x], localizedUrl(x, '/changelog')]), ['x-default', localizedUrl(routing.defaultLocale, '/changelog')]]) },
  }))
  const helpUrls = (path: string) => ({
    languages: Object.fromEntries([...LOCALES.map((x) => [HREFLANG[x], localizedUrl(x, path)]), ['x-default', localizedUrl(routing.defaultLocale, path)]]),
  })
  const helpPaths = ['/help', ...getHelp('en').flatMap((c) => [`/help/${c.id}`, ...c.articles.map((a) => `/help/${c.id}/${a.slug}`)])]
  const help = helpPaths.flatMap((path) =>
    LOCALES.map((l) => ({ url: localizedUrl(l, path), changeFrequency: 'monthly' as const, priority: path === '/help' ? 0.6 : 0.5, alternates: helpUrls(path) })),
  )
  const marketing = ['/templates', '/compare', '/fr/compare', '/free-tools/whatsapp-link-generator', '/free-tools/whatsapp-cost-calculator',...MARKETING_PAGES.map(pagePath)].map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: 'monthly' as const,
    priority: path === '/templates' || path.startsWith('/free-tools') ? 0.6 : 0.8,
  }))
  return [...landing, ...legal, ...changelog, ...help, ...marketing, ...(await blogEntries())]
}
