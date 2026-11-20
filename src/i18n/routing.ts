import { defineRouting } from 'next-intl/routing'
import { LOCALES, defaultLocale } from './locales'

/**
 * Path-based routing for the PUBLIC pages (the landing page) so each
 * language has its own indexable URL: `/` (default language), `/fr`, `/es`,
 * `/pt`, `/ko`. The signed-in app, auth pages and legal pages keep using the
 * language cookie (see request.ts) because search engines never see them
 * or they exist in a single language.
 */
export const routing = defineRouting({
  locales: [...LOCALES],
  defaultLocale: defaultLocale(),
  localePrefix: 'as-needed',
  // Metadata <link rel="alternate"> tags (see src/lib/seo.ts) cover hreflang;
  // skip the Link header, which would repeat it with the wrong host.
  alternateLinks: false,
})
