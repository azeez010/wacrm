import type { SupabaseClient } from '@supabase/supabase-js'
import type { FieldDef, FieldType } from '@/lib/custom-fields/types'

// ============================================================
// Fast custom columns for the Contacts table.
//
//  * `fetchColumnValues`: ONE round trip (contact_column_values, migration
//    074) returns every value plus, for reference fields, the referenced
//    row's label and data, so custom-table sub-columns need no extra query.
//  * `ValueCache`: small LRU so paging back and forth, toggling columns and
//    Refresh paint instantly from memory, then revalidate in the background.
//  * Table metadata (a table's columns) is loaded once, up front, kept in
//    memory and sessionStorage, so the Columns accordion never waits.
// ============================================================

export interface CellData {
  value: string
  refLabel: string | null
  refData: Record<string, unknown> | null
}

export class ValueCache {
  private map = new Map<string, CellData | null>()
  constructor(private readonly max = 3000) {}

  static key(contactId: string, fieldId: string) {
    return `${contactId}|${fieldId}`
  }

  has(key: string) {
    return this.map.has(key)
  }

  /** Returns undefined when unknown; null when known to be empty. */
  get(key: string): CellData | null | undefined {
    if (!this.map.has(key)) return undefined
    const v = this.map.get(key)!
    // refresh recency
    this.map.delete(key)
    this.map.set(key, v)
    return v
  }

  set(key: string, value: CellData | null) {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  clear() {
    this.map.clear()
  }

  get size() {
    return this.map.size
  }
}

export const valueCache = new ValueCache()

export type ValuesByContact = Record<string, Record<string, CellData>>

/** Build the render map for these contacts/fields from whatever is cached. */
export function readCached(cache: ValueCache, contactIds: string[], fieldIds: string[]): ValuesByContact {
  const out: ValuesByContact = {}
  for (const c of contactIds) {
    for (const f of fieldIds) {
      const hit = cache.get(ValueCache.key(c, f))
      if (hit) (out[c] ??= {})[f] = hit
    }
  }
  return out
}

interface ColumnValueRow {
  contact_id: string
  custom_field_id: string
  value: string | null
  ref_label: string | null
  ref_data: Record<string, unknown> | null
}

/** One round trip; also records "empty" for every asked pair that came back with no value. */
export async function fetchColumnValues(
  db: SupabaseClient,
  contactIds: string[],
  fieldIds: string[],
  cache: ValueCache = valueCache,
): Promise<ValuesByContact> {
  const out: ValuesByContact = {}
  if (contactIds.length === 0 || fieldIds.length === 0) return out
  const { data, error } = await db.rpc('contact_column_values', {
    p_contact_ids: contactIds,
    p_field_ids: fieldIds,
  })
  if (error) throw new Error(error.message)
  const seen = new Set<string>()
  for (const row of (data ?? []) as ColumnValueRow[]) {
    const cell: CellData = { value: row.value ?? '', refLabel: row.ref_label, refData: row.ref_data }
    const key = ValueCache.key(row.contact_id, row.custom_field_id)
    seen.add(key)
    cache.set(key, cell)
    ;(out[row.contact_id] ??= {})[row.custom_field_id] = cell
  }
  for (const c of contactIds) {
    for (const f of fieldIds) {
      const key = ValueCache.key(c, f)
      if (!seen.has(key)) cache.set(key, null)
    }
  }
  return out
}

// ---------------- custom table metadata ----------------

export interface TableColumnMeta {
  key: string
  name: string
  type: FieldType
  options: FieldDef['field_options']
}

export interface TableMeta {
  key: string
  name: string
  labelKey: string | null
  columns: TableColumnMeta[]
}

export type TableMetaByKey = Record<string, TableMeta>

const META_TTL_MS = 5 * 60_000
const metaMemory = new Map<string, { at: number; byKey: TableMetaByKey }>()
const metaStorageKey = (accountId: string) => `wacrm:table-meta:${accountId}`

export function clearTableMetaCache(accountId?: string) {
  if (accountId) {
    metaMemory.delete(accountId)
    try {
      window.sessionStorage.removeItem(metaStorageKey(accountId))
    } catch {
      /* ignore */
    }
  } else {
    metaMemory.clear()
  }
}

function readMetaFromStorage(accountId: string): { at: number; byKey: TableMetaByKey } | null {
  try {
    const raw = window.sessionStorage.getItem(metaStorageKey(accountId))
    return raw ? (JSON.parse(raw) as { at: number; byKey: TableMetaByKey }) : null
  } catch {
    return null
  }
}

/** Instantly available metadata (memory or sessionStorage), ignoring expiry. */
export function peekTableMeta(accountId: string): TableMetaByKey | null {
  const mem = metaMemory.get(accountId)
  if (mem) return mem.byKey
  const stored = readMetaFromStorage(accountId)
  if (stored) {
    metaMemory.set(accountId, stored)
    return stored.byKey
  }
  return null
}

interface RawTable {
  key: string
  name: string
  label_field_key: string | null
  columns: { key: string; field_name: string; field_type: FieldType; field_options: FieldDef['field_options']; sort_order: number; archived_at: string | null }[]
}

/**
 * Columns of every table in `tableKeys`, in one query (tables with their
 * columns embedded). Cached for 5 minutes in memory and sessionStorage.
 */
export async function loadTableMeta(
  db: SupabaseClient,
  accountId: string,
  tableKeys: string[],
  force = false,
): Promise<TableMetaByKey> {
  const wanted = [...new Set(tableKeys)]
  const fresh = (e: { at: number; byKey: TableMetaByKey } | null | undefined) =>
    !!e && Date.now() - e.at < META_TTL_MS && wanted.every((k) => k in e.byKey)
  if (!force) {
    const mem = metaMemory.get(accountId)
    if (fresh(mem)) return mem!.byKey
    const stored = readMetaFromStorage(accountId)
    if (fresh(stored)) {
      metaMemory.set(accountId, stored!)
      return stored!.byKey
    }
  }
  if (wanted.length === 0) return {}
  const { data, error } = await db
    .from('custom_tables')
    .select('key, name, label_field_key, columns:custom_fields(key, field_name, field_type, field_options, sort_order, archived_at)')
    .eq('account_id', accountId)
    .in('key', wanted)
  if (error) throw new Error(error.message)
  const byKey: TableMetaByKey = {}
  for (const t of (data ?? []) as unknown as RawTable[]) {
    byKey[t.key] = {
      key: t.key,
      name: t.name,
      labelKey: t.label_field_key,
      columns: t.columns
        .filter((c) => !c.archived_at)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => ({ key: c.key, name: c.field_name, type: c.field_type, options: c.field_options })),
    }
  }
  const entry = { at: Date.now(), byKey }
  metaMemory.set(accountId, entry)
  try {
    window.sessionStorage.setItem(metaStorageKey(accountId), JSON.stringify(entry))
  } catch {
    /* ignore */
  }
  return byKey
}

// ---------------- column preferences ----------------

export interface ColumnPrefsShape {
  hidden: string[]
  custom: string[] | null
  /** "<fieldId>:<columnKey>" sub-columns of custom-table reference fields. */
  refCols?: string[]
}

/** Parse saved preferences defensively (older shapes lack refCols). */
export function parseColumnPrefs(raw: string | null): ColumnPrefsShape {
  const empty: ColumnPrefsShape = { hidden: [], custom: null, refCols: [] }
  if (!raw) return empty
  try {
    const p = JSON.parse(raw) as Partial<ColumnPrefsShape>
    return {
      hidden: Array.isArray(p.hidden) ? p.hidden.filter((x): x is string => typeof x === 'string') : [],
      custom: Array.isArray(p.custom) ? p.custom.filter((x): x is string => typeof x === 'string') : null,
      refCols: Array.isArray(p.refCols) ? p.refCols.filter((x): x is string => typeof x === 'string') : [],
    }
  } catch {
    return empty
  }
}

export const subColumnId = (fieldId: string, columnKey: string) => `${fieldId}:${columnKey}`

export function splitSubColumnId(id: string): { fieldId: string; columnKey: string } | null {
  const i = id.indexOf(':')
  return i > 0 && i < id.length - 1 ? { fieldId: id.slice(0, i), columnKey: id.slice(i + 1) } : null
}
