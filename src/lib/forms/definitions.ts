import type { SupabaseClient } from '@supabase/supabase-js'

import type { FieldDef } from '@/lib/custom-fields/types'
import type { FormCustomField } from './validate-answers'
import type { FormField } from './types'

export interface FormDefinitions {
  /** Non-table contact custom fields by id. */
  customFields: Map<string, FormCustomField>
  /** Custom-table columns by `<referenceFieldId>:<columnKey>`. */
  tableColumns: Map<string, FieldDef>
  /** Reference fields (on contacts) used by table columns: id -> key + table key. */
  refFields: Map<string, { key: string; tableKey: string }>
}

const FIELD_SELECT = 'id, key, field_name, field_type, field_options, required, default_value'

/**
 * Load the custom field / custom table definitions a form refers to, scoped to
 * the account (service-role clients bypass RLS, so the account filter matters).
 */
export async function loadFormDefinitions(
  db: SupabaseClient,
  accountId: string,
  fields: FormField[],
): Promise<FormDefinitions> {
  const defs: FormDefinitions = { customFields: new Map(), tableColumns: new Map(), refFields: new Map() }

  const customIds = [...new Set(fields.flatMap((f) => (f.kind === 'custom_field' && f.customFieldId ? [f.customFieldId] : [])))]
  if (customIds.length > 0) {
    const { data } = await db
      .from('custom_fields')
      .select(FIELD_SELECT)
      .eq('account_id', accountId)
      .is('table_id', null)
      .is('archived_at', null)
      .in('id', customIds)
    for (const r of (data ?? []) as FormCustomField[]) defs.customFields.set(r.id, r)
  }

  const refs = fields.flatMap((f) => (f.kind === 'table_column' && f.tableRef ? [f.tableRef] : []))
  const refIds = [...new Set(refs.map((r) => r.fieldId))]
  if (refIds.length > 0) {
    const { data: refRows } = await db
      .from('custom_fields')
      .select(FIELD_SELECT)
      .eq('account_id', accountId)
      .is('table_id', null)
      .is('archived_at', null)
      .eq('field_type', 'reference')
      .in('id', refIds)
    const tableKeys = new Set<string>()
    for (const r of (refRows ?? []) as FormCustomField[]) {
      const tableKey = (r.field_options as { table_key?: string } | null)?.table_key
      if (!tableKey) continue
      defs.refFields.set(r.id, { key: r.key, tableKey })
      tableKeys.add(tableKey)
    }
    if (tableKeys.size > 0) {
      const { data: tables } = await db
        .from('custom_tables')
        .select('id, key')
        .eq('account_id', accountId)
        .is('archived_at', null)
        .in('key', [...tableKeys])
      const tableIdByKey = new Map(((tables ?? []) as { id: string; key: string }[]).map((t) => [t.key, t.id]))
      const tableIds = [...tableIdByKey.values()]
      if (tableIds.length > 0) {
        const { data: cols } = await db
          .from('custom_fields')
          .select(`${FIELD_SELECT}, table_id`)
          .eq('account_id', accountId)
          .is('archived_at', null)
          .in('table_id', tableIds)
        const keyByTableId = new Map([...tableIdByKey].map(([k, id]) => [id, k]))
        for (const c of (cols ?? []) as (FieldDef & { table_id: string })[]) {
          const tableKey = keyByTableId.get(c.table_id)
          for (const [refId, ref] of defs.refFields) {
            if (ref.tableKey === tableKey) defs.tableColumns.set(`${refId}:${c.key}`, c)
          }
        }
      }
    }
  }
  return defs
}
