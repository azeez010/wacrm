'use client'

import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { LOCALE_COOKIE, isLocale, type Locale } from '@/i18n/locales'

/**
 * Switches the UI language: stores the choice in a cookie (read by
 * src/i18n/request.ts on the next request) and refreshes the page in
 * place - no navigation, no lost scroll position.
 */
export function useSetLocale() {
  const router = useRouter()
  const current = useLocale()
  return (next: string) => {
    if (!isLocale(next) || next === current) return
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    router.refresh()
  }
}

export type { Locale }
