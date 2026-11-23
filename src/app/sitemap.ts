import type { MetadataRoute } from 'next'
import { HREFLANG, LOCALES } from '@/i18n/locales'
import { routing } from '@/i18n/routing'
import { SITE_URL, localizedUrl } from '@/lib/seo'

// Landing page in every language (with hreflang alternates), plus the
// English-only legal pages.
export default function sitemap(): MetadataRoute.Sitemap {
  const languages: Record<string, string> = {}
  for (const l of LOCALES) languages[HREFLANG[l]] = localizedUrl(l)
  languages['x-default'] = localizedUrl(routing.defaultLocale)

  const landing = LOCALES.map((l) => ({
    url: localizedUrl(l),
    changeFrequency: 'weekly' as const,
    priority: l === routing.defaultLocale ? 1 : 0.9,
    alternates: { languages },
  }))
  const legal = ['/docs', '/partners', '/privacy', '/terms', '/data-deletion'].map((p) => ({
    url: `${SITE_URL}${p}`,
    changeFrequency: 'yearly' as const,
    priority: 0.3,
  }))
  return [...landing, ...legal]
}
