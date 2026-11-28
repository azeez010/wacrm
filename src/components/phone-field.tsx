'use client'

import { useState } from 'react'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { CountrySelect } from '@/components/country-select'
import { Input } from '@/components/ui/input'
import { DEFAULT_COUNTRY, callingCode, splitInternational } from '@/lib/forms/countries'
import { phoneHint } from '@/lib/forms/phone-hint'
import { cn } from '@/lib/utils'

/** "+2348031234567" or Meta's digits-only "2348031234567" -> country + national number. */
function parse(value: string): { iso: string; national: string } | null {
  const v = value.trim()
  if (!v) return null
  return splitInternational(v.startsWith('+') ? v : /^\d+$/.test(v) ? `+${v}` : v)
}

/**
 * Dashboard phone field: flag + calling-code picker next to the national number.
 * The value in and out is the full international form ("+2348031234567", or ""
 * while empty), so callers keep validating and saving exactly what they did when
 * this was a plain text box. Typing or pasting a number that starts with "+"
 * switches the picker to that country instead of erroring.
 */
export function PhoneField({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  defaultCountry = DEFAULT_COUNTRY,
  hint = true,
}: {
  id?: string
  value: string
  onChange: (full: string) => void
  onBlur?: () => void
  placeholder?: string
  className?: string
  defaultCountry?: string
  /** Show the live "looks good / keep typing" line under the field. */
  hint?: boolean
}) {
  const t = useTranslations('PhoneField')
  const initial = parse(value)
  const [iso, setIso] = useState(initial?.iso ?? defaultCountry)
  const [national, setNational] = useState(initial?.national ?? value)
  const [focused, setFocused] = useState(false)
  // What we last told the parent (or last received from it); a different value
  // means the parent replaced it (form reset, another contact opened): re-derive.
  const [synced, setSynced] = useState(value)
  if (value !== synced) {
    setSynced(value)
    const p = parse(value)
    if (p) {
      setIso(p.iso)
      setNational(p.national)
    } else {
      setNational(value)
    }
  }

  function emit(nextIso: string, nextNational: string) {
    const digits = nextNational.replace(/\D/g, '').replace(/^0+/, '')
    const full = digits ? `+${callingCode(nextIso)}${digits}` : ''
    setSynced(full)
    onChange(full)
  }

  function onType(raw: string) {
    // A pasted/typed full international number picks its own country.
    if (raw.trim().startsWith('+')) {
      const p = splitInternational(raw)
      if (p) {
        setIso(p.iso)
        setNational(p.national)
        emit(p.iso, p.national)
        return
      }
    }
    setNational(raw)
    emit(iso, raw)
  }

  const status = hint ? phoneHint(value, iso) : ({ state: 'empty' } as const)

  return (
    <div className={cn('w-full', className)}>
    <div className="flex w-full gap-2">
      <CountrySelect
        variant="app"
        value={iso}
        placeholder={t('searchCountry')}
        onChange={(next) => {
          setIso(next)
          emit(next, national)
        }}
      />
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={national}
        placeholder={placeholder}
        onChange={(e) => onType(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          onBlur?.()
        }}
        aria-invalid={status.state === 'invalid' || (status.state === 'partial' && !focused) || undefined}
        maxLength={32}
        className="h-10 min-w-0 flex-1 border-border bg-muted text-foreground placeholder:text-muted-foreground"
      />
    </div>
    {status.state !== 'empty' && (
      <p
        role="status"
        className={cn(
          'mt-1.5 flex items-center gap-1.5 text-xs',
          status.state === 'valid' ? 'text-emerald-600 dark:text-emerald-400' : status.state === 'partial' && focused ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400',
        )}
      >
        {status.state === 'valid' ? <CircleCheck className="size-3.5 shrink-0" aria-hidden /> : <CircleAlert className="size-3.5 shrink-0" aria-hidden />}
        {status.state === 'valid'
          ? t('valid', { number: status.formatted, country: status.country })
          : status.state === 'partial'
            ? focused ? t('keepTyping') : t('tooShort')
            : t('tooLong')}
      </p>
    )}
    </div>
  )
}
