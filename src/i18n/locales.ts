// Single source of truth for the languages the UI ships in.
//
// The active language is resolved per request (see request.ts): the
// visitor's cookie wins, otherwise the deployment default
// (NEXT_PUBLIC_APP_LOCALE, falling back to English). Each entry needs a
// matching messages/<code>.json catalogue.

export const LOCALES = ['en', 'fr', 'es', 'pt', 'ko'] as const
export type Locale = (typeof LOCALES)[number]

/** Each language written in itself, so a visitor can find theirs. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
  pt: 'Português',
  ko: '한국어',
}

export const LOCALE_COOKIE = 'NEXT_LOCALE'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** Deployment default - the language used when a visitor hasn't picked one. */
export function defaultLocale(): Locale {
  const env = process.env.NEXT_PUBLIC_APP_LOCALE
  return isLocale(env) ? env : 'en'
}
