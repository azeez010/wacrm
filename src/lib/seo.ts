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
