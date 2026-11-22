import { formatCurrency } from '@/lib/currency'
import { parseMediaValue } from './media'
import type { FieldDef } from './types'

/** Parse a multi_enum canonical value (JSON array text) into a list. */
export function parseMultiValue(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/**
 * Human-readable text for a stored canonical value. Used by table columns,
 * the contact tab summary and message variables so a value reads the same
 * everywhere. `resolveReference` maps a record id to its label (columns
 * pass a lookup built from the visible page; unknown ids show nothing).
 */
export function formatFieldValue(
  field: Pick<FieldDef, 'field_type' | 'field_options'>,
  value: string | null | undefined,
  opts: {
    defaultCurrency?: string
    locale?: string
    resolveReference?: (id: string) => string | undefined
    yes?: string
    no?: string
  } = {},
): string {
  if (value === null || value === undefined || value === '') return ''
  const o = field.field_options ?? {}
  switch (field.field_type) {
    case 'number': {
      const n = Number(value)
      if (!Number.isFinite(n)) return value
      if (o.format === 'currency') return formatCurrency(n, o.currency ?? opts.defaultCurrency)
      if (o.format === 'percent') {
        return `${new Intl.NumberFormat(opts.locale, { maximumFractionDigits: 2 }).format(n)}%`
      }
      return new Intl.NumberFormat(opts.locale, { maximumFractionDigits: 6 }).format(n)
    }
    case 'bool':
      return value === 'true' ? (opts.yes ?? 'Yes') : (opts.no ?? 'No')
    case 'date': {
      const d = new Date(value)
      if (Number.isNaN(d.getTime())) return value
      return o.include_time
        ? d.toLocaleString(opts.locale, { dateStyle: 'medium', timeStyle: 'short' })
        : d.toLocaleDateString(opts.locale, { dateStyle: 'medium', timeZone: 'UTC' })
    }
    case 'multi_enum':
      return parseMultiValue(value).join(', ')
    case 'media': {
      const m = parseMediaValue(value)
      return m.ok ? m.value.name : ''
    }
    case 'reference':
      return opts.resolveReference?.(value) ?? ''
    default:
      return value
  }
}
