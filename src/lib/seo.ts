import type { Metadata } from 'next'
import { HREFLANG, LOCALES, type Locale } from '@/i18n/locales'
import { routing } from '@/i18n/routing'

/** Public origin used for canonical URLs, hreflang and the sitemap. */
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://wacrm.dataslid.com.ng').replace(/\/+$/, '')

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
