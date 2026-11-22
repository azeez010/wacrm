import { coerceValue } from '@/lib/custom-fields/coerce'
import type { FieldDef, FieldType } from '@/lib/custom-fields/types'
import type { CsvGrid } from './csv-grid'
import { parseTagCell } from './parse-contact-csv'

// ============================================================
// Mapping CSV columns onto everything a contact can hold.
//
//  * One convention for custom-table columns: `<field key>.<column key>`
//    (e.g. profile.name). Plain headers match a field's name or key,
//    ignoring case. Nothing else is guessed.
//  * Every system field can take a CSV column, a fixed value for all rows,
//    or nothing. A column can also carry a default for blank cells.
// ============================================================

export type CoreFieldId = 'phone' | 'name' | 'email' | 'company' | 'tags'
export type SystemFieldId = CoreFieldId | `cf:${string}` | `ref:${string}:${string}`

export type SystemFieldKind = FieldType | 'core_text' | 'tags'

export interface SystemField {
  id: SystemFieldId
  /** Name shown in the mapping list. */
  label: string
  /** The header that auto-matches this field (shown in the instructions). */
  header: string
  kind: SystemFieldKind
  group: 'core' | 'custom' | 'table'
  required?: boolean
  /** For custom fields and table columns: the definition used to validate and edit values. */
  def?: FieldDef
  /** For table columns: the contact field (reference) the table hangs off, and the column key. */
  refFieldId?: string
  refFieldName?: string
  columnKey?: string
  /** For table columns: true when this is the table's label column (finds/creates the row). */
  isLabel?: boolean
}

export type FieldSource =
  | { kind: 'skip' }
  | { kind: 'column'; index: number; fallback?: string }
  | { kind: 'fixed'; value: string }

export type Mapping = Partial<Record<SystemFieldId, FieldSource>>

export const CORE_FIELDS: SystemField[] = [
  { id: 'phone', label: 'Phone', header: 'phone', kind: 'core_text', group: 'core', required: true },
  { id: 'name', label: 'Name', header: 'name', kind: 'core_text', group: 'core' },
  { id: 'email', label: 'Email', header: 'email', kind: 'core_text', group: 'core' },
  { id: 'company', label: 'Company', header: 'company', kind: 'core_text', group: 'core' },
  { id: 'tags', label: 'Tags', header: 'tags', kind: 'tags', group: 'core' },
]

export interface ContactFieldInput {
  id: string
  key?: string
  field_name: string
  field_type: FieldType
  field_options?: FieldDef['field_options']
  required?: boolean
  archived_at?: string | null
}

export interface TableInput {
  key: string
  name: string
  labelKey: string | null
  columns: { key: string; name: string; type: FieldType; options?: FieldDef['field_options'] }[]
}

/** Everything a CSV column can be mapped to, in display order. */
export function buildSystemFields(
  fields: ContactFieldInput[],
  tablesByKey: Record<string, TableInput>,
): SystemField[] {
  const out: SystemField[] = [...CORE_FIELDS]
  for (const f of fields) {
    if (f.archived_at) continue
    if (f.field_type === 'media') continue // files can't come from a CSV cell
    const def: FieldDef = {
      id: f.id,
      key: f.key ?? f.id,
      field_name: f.field_name,
      field_type: f.field_type,
      field_options: f.field_options,
      required: false,
    }
    if (f.field_type === 'reference') {
      const tableKey = (f.field_options as { table_key?: string } | undefined)?.table_key ?? ''
      const table = tablesByKey[tableKey]
      if (!table) continue
      for (const c of table.columns) {
        if (c.type === 'reference' || c.type === 'media') continue
        out.push({
          id: `ref:${f.id}:${c.key}`,
          label: c.name,
          header: `${def.key}.${c.key}`,
          kind: c.type,
          group: 'table',
          def: { id: `${f.id}:${c.key}`, key: c.key, field_name: c.name, field_type: c.type, field_options: c.options },
          refFieldId: f.id,
          refFieldName: f.field_name,
          columnKey: c.key,
          isLabel: c.key === table.labelKey,
        })
      }
      continue
    }
    out.push({
      id: `cf:${f.id}`,
      label: f.field_name,
      header: def.key,
      kind: f.field_type,
      group: 'custom',
      def,
    })
  }
  return out
}

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Pick a CSV column for every field that has an exact header match (case
 * and surrounding spaces ignored). A header feeds one field only (first
 * match wins). Fields without a match are left unmapped.
 */
export function autoMap(headers: string[], fields: SystemField[]): Mapping {
  const used = new Set<number>()
  const mapping: Mapping = {}
  const lower = headers.map(norm)
  for (const f of fields) {
    const candidates = new Set<string>([norm(f.header)])
    if (f.group === 'custom') candidates.add(norm(f.label))
    if (f.group === 'table' && f.refFieldName === undefined) continue
    const index = lower.findIndex((h, i) => !used.has(i) && h !== '' && candidates.has(h))
    if (index >= 0) {
      used.add(index)
      mapping[f.id] = { kind: 'column', index }
    }
  }
  return mapping
}

/** Table columns are also matched by their display name after the dot (profile.Name). */
export function autoMapWithTableNames(headers: string[], fields: SystemField[]): Mapping {
  const mapping = autoMap(headers, fields)
  const used = new Set(
    Object.values(mapping).flatMap((s) => (s && s.kind === 'column' ? [s.index] : [])),
  )
  const lower = headers.map(norm)
  for (const f of fields) {
    if (f.group !== 'table' || mapping[f.id]) continue
    const alt = norm(`${f.header.split('.')[0]}.${f.label}`)
    const index = lower.findIndex((h, i) => !used.has(i) && h === alt)
    if (index >= 0) {
      used.add(index)
      mapping[f.id] = { kind: 'column', index }
    }
  }
  return mapping
}

export function mappedCount(mapping: Mapping): number {
  return Object.values(mapping).filter((s) => s && s.kind !== 'skip').length
}

export function usedColumns(mapping: Mapping): Set<number> {
  const set = new Set<number>()
  for (const s of Object.values(mapping)) if (s && s.kind === 'column') set.add(s.index)
  return set
}

// ---------------- applying the mapping ----------------

export interface PreparedRow {
  /** 0-based position in the file (for messages). */
  line: number
  phone: string
  name?: string
  email?: string
  company?: string
  tagNames: string[]
  /** Raw text per custom field id (validated later). */
  custom: Record<string, string>
  /** Raw text per table column, grouped by the contact's reference field id. */
  tables: Record<string, Record<string, string>>
}

function cellFor(src: FieldSource | undefined, row: string[]): string {
  if (!src || src.kind === 'skip') return ''
  if (src.kind === 'fixed') return src.value.trim()
  const raw = (row[src.index] ?? '').trim()
  return raw !== '' ? raw : (src.fallback ?? '').trim()
}

export function applyMapping(grid: CsvGrid, mapping: Mapping, fields: SystemField[]): PreparedRow[] {
  const byId = new Map(fields.map((f) => [f.id, f]))
  return grid.rows.map((row, line) => {
    const out: PreparedRow = { line, phone: '', tagNames: [], custom: {}, tables: {} }
    for (const [id, src] of Object.entries(mapping) as [SystemFieldId, FieldSource][]) {
      const f = byId.get(id)
      if (!f || !src || src.kind === 'skip') continue
      if (id === 'tags') {
        // Tags: the column's tags, plus tags added to every contact (the "default").
        const fromCell = src.kind === 'column' ? (row[src.index] ?? '') : src.value
        const extra = src.kind === 'column' ? (src.fallback ?? '') : ''
        out.tagNames = parseTagCell([fromCell, extra].filter(Boolean).join(','))
        continue
      }
      const value = cellFor(src, row)
      if (value === '') continue
      if (id === 'phone') out.phone = value
      else if (id === 'name') out.name = value
      else if (id === 'email') out.email = value
      else if (id === 'company') out.company = value
      else if (f.group === 'custom' && f.def) out.custom[f.def.id] = value
      else if (f.group === 'table' && f.refFieldId && f.columnKey) {
        ;(out.tables[f.refFieldId] ??= {})[f.columnKey] = value
      }
    }
    return out
  })
}

export interface CustomValueIssue {
  field: string
  reason: string
}

export interface ValidatedCustomValues {
  values: Record<string, ReturnType<typeof okValue>>
  issues: CustomValueIssue[]
}

function okValue(res: Extract<ReturnType<typeof coerceValue>, { ok: true; clear: false }>) {
  return res.value
}

/** Validate a row's custom field values; bad ones are reported and left out. */
export function validateCustomValues(
  raw: Record<string, string>,
  defs: Map<string, FieldDef>,
  accountId?: string,
): ValidatedCustomValues {
  const out: ValidatedCustomValues = { values: {}, issues: [] }
  for (const [fieldId, text] of Object.entries(raw)) {
    const def = defs.get(fieldId)
    if (!def) continue
    const res = coerceValue(def, text, { accountId })
    if (!res.ok) out.issues.push({ field: def.field_name, reason: res.error })
    else if (!res.clear) out.values[fieldId] = okValue(res)
  }
  return out
}

/** Text for the instructions line: real headers that will match, grouped. */
export function instructionHeaders(fields: SystemField[]) {
  return {
    custom: fields.filter((f) => f.group === 'custom').map((f) => f.header),
    table: fields.filter((f) => f.group === 'table').map((f) => f.header),
  }
}
