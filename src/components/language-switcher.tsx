'use client'

import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Globe } from 'lucide-react'
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, isLocale } from '@/i18n/locales'
import { cn } from '@/lib/utils'

/**
 * Picks the UI language. The choice is stored in a cookie so the server
 * can render the right catalogue on the next request, then the page is
 * refreshed in place (no navigation, no lost scroll position).
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale()
  const router = useRouter()
  const t = useTranslations('Language')

  function onChange(next: string) {
    if (!isLocale(next) || next === locale) return
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    router.refresh()
  }

  return (
    <label className={cn('relative inline-flex items-center', className)}>
      <span className="sr-only">{t('label')}</span>
      <Globe aria-hidden className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
      <select
        value={locale}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 cursor-pointer appearance-none rounded-lg border bg-background pl-8 pr-3 text-sm text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_NAMES[code]}
          </option>
        ))}
      </select>
    </label>
  )
}
