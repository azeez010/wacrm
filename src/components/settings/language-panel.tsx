'use client'

import { Check } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { LocaleFlag } from '@/components/locale-flag'
import { useSetLocale } from '@/hooks/use-set-locale'
import { LOCALES, LOCALE_NAMES, isLocale } from '@/i18n/locales'
import { cn } from '@/lib/utils'
import { SettingsPanelHead } from './settings-panel-head'

/**
 * Language panel - pick the language the app is shown in. Applies
 * immediately and is remembered on this device (cookie), like the theme.
 */
export function LanguagePanel() {
  const t = useTranslations('Settings.language')
  const raw = useLocale()
  const current = isLocale(raw) ? raw : 'en'
  const setLocale = useSetLocale()

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <div
        role="radiogroup"
        aria-label={t('title')}
        className="grid gap-3 sm:grid-cols-2"
      >
        {LOCALES.map((code) => {
          const active = code === current
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setLocale(code)}
              className={cn(
                'flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors',
                active
                  ? 'border-primary/60 ring-2 ring-primary/40'
                  : 'border-border hover:bg-muted/40',
              )}
            >
              <LocaleFlag locale={code} className="h-5 w-7" />
              <span className="flex-1 text-sm font-semibold text-foreground">
                {LOCALE_NAMES[code]}
              </span>
              {active && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                  <Check className="h-3 w-3" />
                  {t('active')}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}
