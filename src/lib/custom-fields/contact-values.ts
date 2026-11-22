import type { SupabaseClient } from '@supabase/supabase-js'
import { coerceValue } from './coerce'
import { parseMultiValue } from './format'
import { parseMediaValue } from './media'
import type { FieldDef } from './types'

// ============================================================
// Contact custom values for the public API / MCP: read as a
// `{ field_key: typedValue }` object, write from the same shape.
// Every write goes through `coerceValue` so the API can never store a
// value the UI would reject.
// ============================================================

type FieldRow = FieldDef & { id: string }

/** Stored canonical text -> the JSON type API callers expect. */
export function toApiValue(field: Pick<FieldDef, 'field_type'>, value: string | null): unknown {
  if (value === null || value === undefined || value === '') return null
  switch (field.field_type) {
    case 'number':
      return Number(value)
    case 'bool':
      return value === 'true'
    case 'multi_enum':
      return parseMultiValue(value)
    case 'media': {
      const m = parseMediaValue(value)
      return m.ok ? { url: m.value.url, name: m.value.name, mime: m.value.mime, size: m.value.size } : null
    }
    default:
      return value
  }
}

/** Custom values for a set of contacts, keyed by contact id then field key. */
export async function loadContactCustomFields(
  db: SupabaseClient,
  accountId: string,
  contactIds: string[],
): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {}
  if (contactIds.length === 0) return out
  const { data } = await db
    .from('contact_custom_values')
    .select('contact_id, value, custom_fields!inner(key, field_type, account_id, archived_at, table_id)')
    .in('contact_id', contactIds)
    .eq('custom_fields.account_id', accountId)
    .is('custom_fields.archived_at', null)
    .is('custom_fields.table_id', null)
  type Row = {
    contact_id: string
    value: string | null
    custom_fields: { key: string; field_type: FieldDef['field_type'] } | { key: string; field_type: FieldDef['field_type'] }[] | null
  }
  for (const row of (data ?? []) as unknown as Row[]) {
    const f = Array.isArray(row.custom_fields) ? row.custom_fields[0] : row.custom_fields
    if (!f) continue
    ;(out[row.contact_id] ??= {})[f.key] = toApiValue(f, row.value)
  }
  return out
}

export type WriteResult = { ok: true } | { ok: false; error: string }

/**
 * Apply `{ field_key: value }` to a contact. `null` / '' clears a value.
 * All-or-nothing on validation: nothing is written if any value is invalid.
 */
export async function writeContactCustomFields(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  input: unknown,
): Promise<WriteResult> {
  if (input === undefined) return { ok: true }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: "'custom_fields' must be an object of field key to value" }
  }
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length === 0) return { ok: true }

  const { data: defs } = await db
    .from('custom_fields')
    .select('id, key, field_name, field_type, field_options, required, default_value')
    .eq('account_id', accountId)
    .is('table_id', null)
    .is('archived_at', null)
    .in('key', entries.map(([k]) => k))
  const byKey = new Map(((defs ?? []) as FieldRow[]).map((f) => [f.key, f]))

  const upserts: Record<string, unknown>[] = []
  const cleared: string[] = []
  const refs: { id: string; value: string }[] = []
  for (const [key, raw] of entries) {
    const field = byKey.get(key)
    if (!field) return { ok: false, error: `Unknown custom field '${key}'` }
    const res = coerceValue(field, raw, { accountId })
    if (!res.ok) return { ok: false, error: res.error }
    if (res.clear) cleared.push(field.id)
    else {
      upserts.push({
        contact_id: contactId,
        custom_field_id: field.id,
        account_id: accountId,
        ...res.value,
      })
      if (field.field_type === 'reference') refs.push({ id: field.id, value: res.value.value })
    }
  }

  if (refs.length > 0) {
    const { data: found } = await db
      .from('custom_records')
      .select('id')
      .eq('account_id', accountId)
      .in('id', refs.map((r) => r.value))
    const have = new Set((found ?? []).map((r) => r.id as string))
    const missing = refs.find((r) => !have.has(r.value))
    if (missing) return { ok: false, error: 'A referenced row does not exist' }
  }

  if (upserts.length > 0) {
    const { error } = await db
      .from('contact_custom_values')
      .upsert(upserts, { onConflict: 'contact_id,custom_field_id' })
    if (error) return { ok: false, error: 'Failed to save custom fields' }
  }
  if (cleared.length > 0) {
    await db
      .from('contact_custom_values')
      .delete()
      .eq('contact_id', contactId)
      .in('custom_field_id', cleared)
  }
  await db
    .from('contacts')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', contactId)
    .eq('account_id', accountId)
  return { ok: true }
}
