// ============================================================
// Bulk contact import for the public API / MCP (POST /api/v1/contacts/import).
// A CSV (or a JSON list) in, one result per row out. Existing contacts are NOT
// overwritten (their name, email and company stay): only tags and custom fields are added.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { parseCsvGrid } from '@/lib/contacts/csv-grid'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { writeContactCustomFields } from '@/lib/custom-fields/contact-values'
import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils'
import { addContactTags, ContactError, findOrCreateContact } from './contacts'

export const IMPORT_MAX_ROWS = 500
export const IMPORT_MAX_CSV_CHARS = 400_000

export interface ImportRow {
  phone: string
  name?: string
  email?: string
  company?: string
  tags?: string[]
  custom_fields?: Record<string, unknown>
}

export interface ImportResult {
  row: number
  phone: string
  status: 'created' | 'existing' | 'would_create' | 'would_update' | 'failed'
  error?: string
}

const PHONE_HEADERS = new Set(['phone', 'phone_number', 'mobile', 'whatsapp', 'number', 'telephone', 'tel'])
const NAME_HEADERS = new Set(['name', 'full_name', 'fullname'])
const EMAIL_HEADERS = new Set(['email', 'e_mail', 'email_address'])
const COMPANY_HEADERS = new Set(['company', 'organization', 'organisation', 'business'])
const TAG_HEADERS = new Set(['tags', 'tag', 'labels'])

const keyOf = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

/** Turn CSV text into import rows. Unknown columns are custom field keys. */
export function rowsFromCsv(csv: string): { ok: true; rows: ImportRow[] } | { ok: false; error: string } {
  if (csv.length > IMPORT_MAX_CSV_CHARS) return { ok: false, error: `The CSV is too large (max ${IMPORT_MAX_CSV_CHARS} characters). Split it into parts.` }
  const grid = parseCsvGrid(csv)
  const keys = grid.headers.map(keyOf)
  const phoneCol = keys.findIndex((k) => PHONE_HEADERS.has(k))
  if (phoneCol === -1) return { ok: false, error: 'The CSV needs a "phone" column (international format, e.g. +2348012345678).' }
  if (grid.rows.length === 0) return { ok: false, error: 'The CSV has no data rows.' }
  if (grid.rows.length > IMPORT_MAX_ROWS) return { ok: false, error: `Too many rows (${grid.rows.length}); the limit is ${IMPORT_MAX_ROWS} per call. Split it into parts.` }

  const rows: ImportRow[] = grid.rows.map((cells) => {
    const row: ImportRow = { phone: (cells[phoneCol] ?? '').trim() }
    const custom: Record<string, unknown> = {}
    keys.forEach((k, i) => {
      const v = (cells[i] ?? '').trim()
      if (i === phoneCol || !k || v === '') return
      if (NAME_HEADERS.has(k)) row.name = v
      else if (EMAIL_HEADERS.has(k)) row.email = v
      else if (COMPANY_HEADERS.has(k)) row.company = v
      else if (TAG_HEADERS.has(k)) row.tags = v.split(/[;|]/).map((t) => t.trim()).filter(Boolean)
      else custom[k] = v
    })
    if (Object.keys(custom).length > 0) row.custom_fields = custom
    return row
  })
  return { ok: true, rows }
}

/** Validate a JSON list of contacts into import rows. */
export function rowsFromList(list: unknown): { ok: true; rows: ImportRow[] } | { ok: false; error: string } {
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: "'contacts' must be a non-empty array" }
  if (list.length > IMPORT_MAX_ROWS) return { ok: false, error: `Too many contacts (${list.length}); the limit is ${IMPORT_MAX_ROWS} per call.` }
  const rows: ImportRow[] = []
  for (const [i, c] of list.entries()) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, error: `contacts[${i}] must be an object` }
    const o = c as Record<string, unknown>
    rows.push({
      phone: typeof o.phone === 'string' ? o.phone.trim() : '',
      name: typeof o.name === 'string' ? o.name : undefined,
      email: typeof o.email === 'string' ? o.email : undefined,
      company: typeof o.company === 'string' ? o.company : undefined,
      tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string') : undefined,
      custom_fields: o.custom_fields && typeof o.custom_fields === 'object' && !Array.isArray(o.custom_fields) ? (o.custom_fields as Record<string, unknown>) : undefined,
    })
  }
  return { ok: true, rows }
}

async function importOne(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  row: ImportRow,
  index: number,
  extraTags: string[],
  dryRun: boolean,
): Promise<ImportResult> {
  const base = { row: index + 1, phone: row.phone }
  try {
    const phone = parseInternationalPhone(row.phone)
    if (!phone) return { ...base, status: 'failed', error: 'Phone must be international with a leading + (e.g. +14155550123)' }

    if (dryRun) {
      const exists = await findExistingContact(db, accountId, phone)
      return { ...base, phone, status: exists ? 'would_update' : 'would_create' }
    }

    const { id, created } = await findOrCreateContact(db, accountId, auditUserId, {
      phone: row.phone,
      name: row.name,
      email: row.email,
      company: row.company,
      leadSource: 'Import',
    })
    const tags = [...new Set([...(row.tags ?? []), ...extraTags])]
    if (tags.length > 0) await addContactTags(db, accountId, auditUserId, id, tags)
    if (row.custom_fields) {
      const cf = await writeContactCustomFields(db, accountId, id, row.custom_fields)
      if (!cf.ok) return { ...base, phone, status: 'failed', error: cf.error }
    }
    return { ...base, phone, status: created ? 'created' : 'existing' }
  } catch (e) {
    return { ...base, status: 'failed', error: e instanceof ContactError || e instanceof Error ? e.message : 'Unknown error' }
  }
}

/** Run the import, a few rows at a time. Never throws: each row reports its own outcome. */
export async function importContacts(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  rows: ImportRow[],
  opts: { tags?: string[]; dryRun?: boolean },
): Promise<{ summary: Record<string, number>; results: ImportResult[] }> {
  const results: ImportResult[] = new Array(rows.length)
  let next = 0
  const worker = async () => {
    while (next < rows.length) {
      const i = next++
      results[i] = await importOne(db, accountId, auditUserId, rows[i], i, opts.tags ?? [], opts.dryRun === true)
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, rows.length) }, worker))
  const summary: Record<string, number> = { total: rows.length }
  for (const r of results) summary[r.status] = (summary[r.status] ?? 0) + 1
  return { summary, results }
}
