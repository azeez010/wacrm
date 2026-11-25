'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CountrySelect } from '@/components/country-select'
import { Input } from '@/components/ui/input'
import { DEFAULT_COUNTRY, callingCode, splitInternational } from '@/lib/forms/countries'
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
}: {
  id?: string
  value: string
  onChange: (full: string) => void
  onBlur?: () => void
  placeholder?: string
  className?: string
  defaultCountry?: string
}) {
  const t = useTranslations('PhoneField')
  const initial = parse(value)
  const [iso, setIso] = useState(initial?.iso ?? defaultCountry)
  const [national, setNational] = useState(initial?.national ?? value)
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

  return (
    <div className={cn('flex w-full gap-2', className)}>
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
        onBlur={onBlur}
        maxLength={32}
        className="h-10 min-w-0 flex-1 border-border bg-muted text-foreground placeholder:text-muted-foreground"
      />
    </div>
  )
}
