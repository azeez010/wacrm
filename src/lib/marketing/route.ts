import type { MarketingPage } from './pages'

export type LocaleGuard = { kind: 'ok' } | { kind: 'redirect'; to: string } | { kind: 'notfound' }

/**
 * Marketing pages are written in one language each. An English page lives only at its unprefixed URL
 * (any `/<lang>/` copy permanently redirects there, so search engines never see duplicates); a French page
 * lives only under `/fr/`.
 */
export function guardLocale(page: Pick<MarketingPage, 'kind' | 'slug' | 'lang'>, locale: string): LocaleGuard {
  const lang = page.lang ?? 'en'
  if (lang === locale) return { kind: 'ok' }
  if (lang === 'en') return { kind: 'redirect', to: `/${page.kind}/${page.slug}` }
  return { kind: 'notfound' }
}

/** Public path of a marketing page, including its language prefix. */
export function pagePath(page: Pick<MarketingPage, 'kind' | 'slug' | 'lang'>): string {
  const prefix = page.lang && page.lang !== 'en' ? `/${page.lang}` : ''
  return `${prefix}/${page.kind}/${page.slug}`
}

/** Matches `/<lang>/signup` and `/<lang>/login` for a non-default language. */
export const LOCALE_AUTH_PATH = /^\/(fr|es|pt|ko|ar|hi|id|sw)\/(signup|login)\/?$/
