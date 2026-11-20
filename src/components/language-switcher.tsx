'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Check, ChevronDown } from 'lucide-react'
import { LOCALES, LOCALE_NAMES, isLocale, type Locale } from '@/i18n/locales'
import { LocaleFlag } from '@/components/locale-flag'
import { useSetLocale } from '@/hooks/use-set-locale'
import { LOCALE_COOKIE } from '@/i18n/locales'
import { localizedPath } from '@/lib/seo'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/**
 * Compact language picker (flag + name).
 *
 * `mode="path"` is for the localized public pages: it loads the same page under
 * the other language's URL (so each language has its own indexable address) and
 * writes the same cookie the app reads, so login and the dashboard follow.
 * It is a full page load on purpose: the root layout (html lang, intl provider)
 * isn't remounted by a soft navigation, which left the picker showing the old
 * language and made the next switch build a bad `/en/es` path.
 * `mode="cookie"` (default) just stores the choice and refreshes in place.
 */
export function LanguageSwitcher({
  className,
  mode = 'cookie',
}: {
  className?: string
  mode?: 'cookie' | 'path'
}) {
  const raw = useLocale()
  const locale = isLocale(raw) ? raw : 'en'
  const setCookieLocale = useSetLocale()
  const t = useTranslations('Language')

  function setLocale(next: Locale) {
    if (mode === 'path') {
      if (next === locale) return
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
      // Current path without any language prefix, from the real URL (not a
      // possibly stale React value).
      const bare =
        window.location.pathname.replace(new RegExp(`^/(${LOCALES.join('|')})(?=/|$)`), '') || '/'
      window.location.assign(`${localizedPath(next, bare)}${window.location.search}${window.location.hash}`)
    } else {
      setCookieLocale(next)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('label')}
        className={cn(
          'inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg border bg-background px-3 text-sm text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted',
          className,
        )}
      >
        <LocaleFlag locale={locale} />
        <span>{LOCALE_NAMES[locale]}</span>
        <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="min-w-44 bg-popover text-popover-foreground ring-border"
      >
        {LOCALES.map((code) => (
          <DropdownMenuItem
            key={code}
            onClick={() => setLocale(code)}
            className="gap-2.5"
          >
            <LocaleFlag locale={code} />
            <span className="flex-1">{LOCALE_NAMES[code]}</span>
            {code === locale && <Check aria-hidden className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
