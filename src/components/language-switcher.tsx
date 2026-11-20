'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Check, ChevronDown } from 'lucide-react'
import { LOCALES, LOCALE_NAMES, isLocale } from '@/i18n/locales'
import { LocaleFlag } from '@/components/locale-flag'
import { useSetLocale } from '@/hooks/use-set-locale'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/** Compact language picker (flag + name) for the landing page and auth screens. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const raw = useLocale()
  const locale = isLocale(raw) ? raw : 'en'
  const setLocale = useSetLocale()
  const t = useTranslations('Language')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('label')}
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-lg border bg-background px-3 text-sm text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted',
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
