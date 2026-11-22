import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils'
import { acceptsMime, kindFromMime, mediaBelongsToAccount, MEDIA_FIELD_MAX_BYTES, parseMediaValue } from './media'
import {
  MAX_OPTIONS,
  MAX_OPTION_LENGTH,
  MAX_TEXT_LENGTH,
  RESERVED_FIELD_KEYS,
  type CoerceResult,
  type CoercedValue,
  type FieldDef,
  type FieldType,
  type TypedColumns,
  MEDIA_ACCEPT_VALUES,
} from './types'

const EMPTY_TYPED: TypedColumns = {
  value_number: null,
  value_date: null,
  value_bool: null,
  value_text_array: null,
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'on'])
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'off'])

const fail = (error: string): CoerceResult => ({ ok: false, error })

function isEmpty(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true
  if (typeof raw === 'string') return raw.trim() === ''
  if (Array.isArray(raw)) return raw.length === 0
  return false
}

/** Turn "Plan name" into a valid key ("plan_name"). */
export function slugifyKey(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  if (!base) return 'field'
  return /^[a-z]/.test(base) ? base : `f_${base}`
}

export function isValidKey(key: string): boolean {
  return /^[a-z][a-z0-9_]{0,62}$/.test(key) && !RESERVED_FIELD_KEYS.has(key)
}

function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  // "15,000" and "15 000" are common in pasted/imported data.
  const cleaned = raw.trim().replace(/[,\s]/g, '').replace(/%$/, '')
  if (cleaned === '' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function parseBool(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw === 1 ? true : raw === 0 ? false : null
  if (typeof raw !== 'string') return null
  const w = raw.trim().toLowerCase()
  if (TRUE_WORDS.has(w)) return true
  if (FALSE_WORDS.has(w)) return false
  return null
}

/** Accepts YYYY-MM-DD or a full ISO datetime. Date-only values pin to UTC midnight. */
function parseDate(raw: unknown, includeTime: boolean): string | null {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw.toISOString()
  }
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00.000Z`)
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s
      ? null
      : d.toISOString()
  }
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return null
  const d = new Date(s.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return null
  if (!includeTime) {
    return new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`).toISOString()
  }
  return d.toISOString()
}

/**
 * A moment in time: ISO with Z / an offset, or a bare "YYYY-MM-DDTHH:mm"
 * which is read as UTC (the form converts the account-time-zone input to a
 * real instant before it gets here, see datetime-tz.ts).
 */
function parseDateTime(raw: unknown): string | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString()
  if (typeof raw !== 'string') return null
  let s = raw.trim().replace(' ', 'T')
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z'
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += 'Z'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** "example.com" becomes https://example.com; only http(s) links with a real host pass. */
export function normalizeUrl(raw: string): string | null {
  const s = raw.trim()
  if (!s || s.length > 2000 || /\s/.test(s)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null
    return u.href
  } catch {
    return null
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function normalizeEmail(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  return s.length <= 254 && EMAIL_RE.test(s) ? s : null
}

/** International number with a leading +; stored as +digits. */
export function normalizePhoneValue(raw: string): string | null {
  const digits = parseInternationalPhone(raw)
  return digits ? `+${digits}` : null
}

function matchOption(options: string[], raw: string): string | null {
  const wanted = raw.trim().toLowerCase()
  return options.find((o) => o.toLowerCase() === wanted) ?? null
}

function toList(raw: unknown): string[] | null {
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean)
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (s.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(s)
      return Array.isArray(parsed)
        ? parsed.map((v) => String(v).trim()).filter(Boolean)
        : null
    } catch {
      return null
    }
  }
  return s
    .split(/[,;|]/)
    .map((v) => v.trim())
    .filter(Boolean)
}

/**
 * Validate + normalise one raw value against a field definition.
 *
 * The single write-path helper: contact detail saves, imports,
 * automations and the public API all go through it so the canonical
 * `value` and the typed shadow columns can never disagree.
 * Empty input means "clear this value" (or an error for required fields).
 * `reference` values are only shape-checked here (a UUID); whether the
 * record exists is checked by the caller, which has database access.
 */
export function coerceValue(
  field: FieldDef,
  raw: unknown,
  ctx: { accountId?: string } = {},
): CoerceResult {
  if (isEmpty(raw)) {
    return field.required
      ? fail(`${field.field_name} is required`)
      : { ok: true, clear: true }
  }

  const opts = field.field_options ?? {}
  const type: FieldType = field.field_type
  const done = (value: string, typed: Partial<TypedColumns> = {}): CoerceResult => ({
    ok: true,
    clear: false,
    value: { value, ...EMPTY_TYPED, ...typed } satisfies CoercedValue,
  })

  switch (type) {
    case 'text': {
      const s = String(raw).trim()
      if (s.length > MAX_TEXT_LENGTH) {
        return fail(`${field.field_name} is longer than ${MAX_TEXT_LENGTH} characters`)
      }
      return done(s)
    }
    case 'number': {
      const n = parseNumber(raw)
      if (n === null) return fail(`${field.field_name} must be a number`)
      if (opts.min !== undefined && n < opts.min) {
        return fail(`${field.field_name} must be at least ${opts.min}`)
      }
      if (opts.max !== undefined && n > opts.max) {
        return fail(`${field.field_name} must be at most ${opts.max}`)
      }
      return done(String(n), { value_number: n })
    }
    case 'bool': {
      const b = parseBool(raw)
      if (b === null) return fail(`${field.field_name} must be yes or no`)
      return done(b ? 'true' : 'false', { value_bool: b })
    }
    case 'date': {
      const iso = parseDate(raw, Boolean(opts.include_time))
      if (!iso) return fail(`${field.field_name} must be a valid date (YYYY-MM-DD)`)
      return done(iso, { value_date: iso })
    }
    case 'datetime': {
      const iso = parseDateTime(raw)
      if (!iso) return fail(`${field.field_name} must be a valid date and time`)
      return done(iso, { value_date: iso })
    }
    case 'url': {
      const u = normalizeUrl(String(raw))
      if (!u) return fail(`${field.field_name} must be a valid web link (https://...)`)
      return done(u)
    }
    case 'email': {
      const e = normalizeEmail(String(raw))
      if (!e) return fail(`${field.field_name} must be a valid email address`)
      return done(e)
    }
    case 'phone': {
      const p = normalizePhoneValue(String(raw))
      if (!p) return fail(`${field.field_name} must be an international number starting with + (e.g. +14155550123)`)
      return done(p)
    }
    case 'enum': {
      const match = matchOption(opts.options ?? [], String(raw))
      if (!match) return fail(`${field.field_name} must be one of the listed options`)
      return done(match)
    }
    case 'multi_enum': {
      const list = toList(raw)
      if (!list) return fail(`${field.field_name} must be a list of options`)
      const picked: string[] = []
      for (const item of list) {
        const match = matchOption(opts.options ?? [], item)
        if (!match) return fail(`"${item}" is not an option for ${field.field_name}`)
        if (!picked.includes(match)) picked.push(match)
      }
      if (picked.length === 0) return { ok: true, clear: true }
      return done(JSON.stringify(picked), { value_text_array: picked })
    }
    case 'reference': {
      const id = String(raw).trim()
      if (!UUID_RE.test(id)) return fail(`${field.field_name} must reference an existing row`)
      return done(id.toLowerCase())
    }
    case 'media': {
      const parsed = parseMediaValue(raw)
      if (!parsed.ok) return fail(`${field.field_name}: ${parsed.error}`)
      const v = parsed.value
      if (!acceptsMime(opts.accept, v.mime)) {
        return fail(`${field.field_name} only accepts ${opts.accept} files`)
      }
      if (v.size > MEDIA_FIELD_MAX_BYTES[kindFromMime(v.mime)]) {
        return fail(`${field.field_name}: file is too large`)
      }
      if (ctx.accountId && !mediaBelongsToAccount(v, ctx.accountId)) {
        return fail(`${field.field_name}: file does not belong to this account`)
      }
      return done(JSON.stringify(v))
    }
    default:
      return fail(`Unsupported field type "${String(type)}"`)
  }
}

/** Validate the options a field is being created/edited with. */
export function validateFieldOptions(
  type: FieldType,
  options: unknown
): { ok: true } | { ok: false; error: string } {
  const o = (options ?? {}) as Record<string, unknown>
  if (type === 'enum' || type === 'multi_enum') {
    const list = o.options
    if (!Array.isArray(list) || list.length === 0) {
      return { ok: false, error: 'Add at least one option' }
    }
    if (list.length > MAX_OPTIONS) {
      return { ok: false, error: `At most ${MAX_OPTIONS} options` }
    }
    const seen = new Set<string>()
    for (const item of list) {
      if (typeof item !== 'string' || !item.trim()) {
        return { ok: false, error: 'Options cannot be empty' }
      }
      if (item.trim().length > MAX_OPTION_LENGTH) {
        return { ok: false, error: `Options are limited to ${MAX_OPTION_LENGTH} characters` }
      }
      const k = item.trim().toLowerCase()
      if (seen.has(k)) return { ok: false, error: `Duplicate option "${item.trim()}"` }
      seen.add(k)
    }
  }
  if (type === 'reference') {
    if (typeof o.table_key !== 'string' || !o.table_key) {
      return { ok: false, error: 'Pick a table to reference' }
    }
  }
  if (type === 'media') {
    if (o.accept !== undefined && !(MEDIA_ACCEPT_VALUES as readonly string[]).includes(String(o.accept))) {
      return { ok: false, error: 'Unknown file type restriction' }
    }
  }
  if (type === 'number') {
    if (o.min !== undefined && o.max !== undefined && Number(o.min) > Number(o.max)) {
      return { ok: false, error: 'Minimum cannot be greater than maximum' }
    }
    if (o.format !== undefined && !['plain', 'currency', 'percent'].includes(String(o.format))) {
      return { ok: false, error: 'Unknown number format' }
    }
  }
  return { ok: true }
}
