import type { SupabaseClient } from '@supabase/supabase-js'
import { assertFeature, assertWithinLimit, FeatureLockedError, PlanLimitError } from '@/lib/billing/entitlements'
import { hasMinRole, isAccountRole, type AccountRole } from '@/lib/auth/roles'
import { coerceValue, isValidKey, slugifyKey, validateFieldOptions } from './coerce'
import { FIELD_TYPES, type FieldDef, type FieldOptions, type FieldType } from './types'

// ============================================================
// Server-side operations for custom fields, custom tables and table
// rows. Shared by the session-authenticated routes under
// /api/custom-fields and /api/custom-tables (and, later, API v1 / MCP).
//
// Callers pass a service-role client + the verified account id: every
// query here is scoped by account_id explicitly because the service
// role bypasses RLS.
// ============================================================

export interface Ctx {
  db: SupabaseClient
  accountId: string
  userId: string | null
  role: AccountRole
}

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

const ok = <T>(data: T): Result<T> => ({ ok: true, data })
const fail = (status: number, error: string): Result<never> => ({ ok: false, status, error })

/** Map entitlement errors to a Result; rethrow anything else. */
async function gated<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof PlanLimitError || err instanceof FeatureLockedError) {
      return fail(402, err.message)
    }
    throw err
  }
}

export interface CustomFieldRow extends FieldDef {
  account_id: string
  user_id: string
  table_id: string | null
  show_in_table: boolean
  sort_order: number
  description: string | null
  required: boolean
  default_value: string | null
  source: string | null
  locked: boolean
  archived_at: string | null
  min_role_edit: AccountRole
  hidden_from_viewers: boolean
  created_at: string
}

export interface CustomTableRow {
  id: string
  account_id: string
  key: string
  name: string
  description: string | null
  label_field_key: string | null
  source: string | null
  locked: boolean
  archived_at: string | null
  min_role_edit: AccountRole
  created_at: string
}

// ------------------------------------------------------------
// Fields
// ------------------------------------------------------------

export interface FieldInput {
  name?: unknown
  key?: unknown
  type?: unknown
  options?: unknown
  show_in_table?: unknown
  description?: unknown
  required?: unknown
  default_value?: unknown
  min_role_edit?: unknown
  hidden_from_viewers?: unknown
  source?: unknown
  locked?: unknown
  /** custom_tables.id when this field is a table column. */
  table_id?: unknown
}

async function uniqueKey(ctx: Ctx, tableId: string | null, wanted: string): Promise<string> {
  let q = ctx.db.from('custom_fields').select('key').eq('account_id', ctx.accountId)
  q = tableId ? q.eq('table_id', tableId) : q.is('table_id', null)
  const { data } = await q.like('key', `${wanted}%`)
  const taken = new Set((data ?? []).map((r: { key: string }) => r.key))
  if (!taken.has(wanted)) return wanted
  for (let i = 2; i < 1000; i++) {
    const candidate = `${wanted.slice(0, 58)}_${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${wanted.slice(0, 50)}_${Date.now()}`
}

export async function listFields(
  ctx: Ctx,
  opts: { tableId?: string | null; includeArchived?: boolean } = {},
): Promise<Result<CustomFieldRow[]>> {
  let q = ctx.db.from('custom_fields').select('*').eq('account_id', ctx.accountId)
  q = opts.tableId ? q.eq('table_id', opts.tableId) : q.is('table_id', null)
  if (!opts.includeArchived) q = q.is('archived_at', null)
  const { data, error } = await q.order('sort_order').order('created_at')
  if (error) return fail(500, error.message)
  return ok((data ?? []) as CustomFieldRow[])
}

export async function createField(ctx: Ctx, input: FieldInput): Promise<Result<CustomFieldRow>> {
  if (!hasMinRole(ctx.role, 'admin')) return fail(403, 'Only admins can create fields')

  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return fail(400, 'Field name is required')
  if (name.length > 80) return fail(400, 'Field name is too long')
  const type = (input.type ?? 'text') as FieldType
  if (!FIELD_TYPES.includes(type)) return fail(400, 'Unknown field type')

  const tableId = typeof input.table_id === 'string' && input.table_id ? input.table_id : null
  const options = ((input.options as FieldOptions | undefined) ?? {}) as FieldOptions
  const optCheck = validateFieldOptions(type, options)
  if (!optCheck.ok) return fail(400, optCheck.error)

  const wantedKey = typeof input.key === 'string' && input.key ? input.key : slugifyKey(name)
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(wantedKey)) return fail(400, 'Invalid field key')
  const baseKey = isValidKey(wantedKey) ? wantedKey : `${wantedKey}_field`

  const role = input.min_role_edit
  if (role !== undefined && !(isAccountRole(role) && role !== 'viewer')) {
    return fail(400, 'Invalid role')
  }

  return gated(async () => {
    await assertFeature(ctx.db, ctx.accountId, 'custom_fields')

    // Duplicate display name within the same scope.
    let dup = ctx.db
      .from('custom_fields')
      .select('id')
      .eq('account_id', ctx.accountId)
      .is('archived_at', null)
      .ilike('field_name', name.replace(/[%_]/g, '\\$&'))
    dup = tableId ? dup.eq('table_id', tableId) : dup.is('table_id', null)
    const { data: existing } = await dup.limit(1)
    if (existing && existing.length > 0) return fail(409, `A field named "${name}" already exists`)

    if (!tableId) {
      const { count } = await ctx.db
        .from('custom_fields')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .is('table_id', null)
        .is('archived_at', null)
      await assertWithinLimit(ctx.db, ctx.accountId, 'custom_fields_max', count ?? 0)
    }

    if (type === 'reference') {
      const { data: target } = await ctx.db
        .from('custom_tables')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('key', options.table_key as string)
        .is('archived_at', null)
        .maybeSingle()
      if (!target) return fail(400, 'The referenced table does not exist')
    }

    const key = await uniqueKey(ctx, tableId, baseKey)
    const { data: last } = await (tableId
      ? ctx.db.from('custom_fields').select('sort_order').eq('table_id', tableId)
      : ctx.db.from('custom_fields').select('sort_order').eq('account_id', ctx.accountId).is('table_id', null)
    )
      .order('sort_order', { ascending: false })
      .limit(1)
    const sortOrder = ((last?.[0] as { sort_order?: number } | undefined)?.sort_order ?? 0) + 1

    const { data, error } = await ctx.db
      .from('custom_fields')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        field_name: name,
        key,
        field_type: type,
        field_options: options,
        table_id: tableId,
        show_in_table: input.show_in_table === true,
        sort_order: sortOrder,
        description: typeof input.description === 'string' ? input.description.trim() || null : null,
        required: input.required === true,
        default_value:
          typeof input.default_value === 'string' ? input.default_value.trim() || null : null,
        min_role_edit: role ?? 'agent',
        hidden_from_viewers: input.hidden_from_viewers === true,
        source: typeof input.source === 'string' ? input.source : null,
        locked: input.locked === true,
      })
      .select()
      .single()
    if (error) return fail(500, error.message)
    return ok(data as CustomFieldRow)
  })
}

export interface FieldPatch extends Omit<FieldInput, 'type' | 'key' | 'table_id'> {
  sort_order?: unknown
  archived?: unknown
}

export async function updateField(
  ctx: Ctx,
  fieldId: string,
  patch: FieldPatch,
): Promise<Result<CustomFieldRow>> {
  if (!hasMinRole(ctx.role, 'admin')) return fail(403, 'Only admins can edit fields')

  const { data: current } = await ctx.db
    .from('custom_fields')
    .select('*')
    .eq('id', fieldId)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!current) return fail(404, 'Field not found')
  const field = current as CustomFieldRow

  const update: Record<string, unknown> = {}

  // App-owned fields can only change presentation, never shape or name.
  if (!field.locked) {
    if (patch.name !== undefined) {
      const name = typeof patch.name === 'string' ? patch.name.trim() : ''
      if (!name) return fail(400, 'Field name is required')
      if (name.length > 80) return fail(400, 'Field name is too long')
      if (name.toLowerCase() !== field.field_name.toLowerCase()) {
        let dup = ctx.db
          .from('custom_fields')
          .select('id')
          .eq('account_id', ctx.accountId)
          .is('archived_at', null)
          .neq('id', fieldId)
          .ilike('field_name', name.replace(/[%_]/g, '\\$&'))
        dup = field.table_id ? dup.eq('table_id', field.table_id) : dup.is('table_id', null)
        const { data: existing } = await dup.limit(1)
        if (existing && existing.length > 0) return fail(409, `A field named "${name}" already exists`)
      }
      update.field_name = name
    }
    if (patch.options !== undefined) {
      const optCheck = validateFieldOptions(field.field_type, patch.options)
      if (!optCheck.ok) return fail(400, optCheck.error)
      update.field_options = patch.options
    }
    if (patch.description !== undefined) {
      update.description =
        typeof patch.description === 'string' ? patch.description.trim() || null : null
    }
    if (patch.required !== undefined) update.required = patch.required === true
    if (patch.default_value !== undefined) {
      update.default_value =
        typeof patch.default_value === 'string' ? patch.default_value.trim() || null : null
    }
    if (patch.min_role_edit !== undefined) {
      if (!(isAccountRole(patch.min_role_edit) && patch.min_role_edit !== 'viewer')) {
        return fail(400, 'Invalid role')
      }
      update.min_role_edit = patch.min_role_edit
    }
    if (patch.hidden_from_viewers !== undefined) {
      update.hidden_from_viewers = patch.hidden_from_viewers === true
    }
  }
  if (patch.show_in_table !== undefined) update.show_in_table = patch.show_in_table === true
  if (patch.sort_order !== undefined) {
    const n = Number(patch.sort_order)
    if (!Number.isInteger(n)) return fail(400, 'Invalid sort order')
    update.sort_order = n
  }
  if (patch.archived !== undefined) {
    if (field.locked && patch.archived === true) return fail(403, 'This field is managed by an app')
    update.archived_at = patch.archived === true ? new Date().toISOString() : null
  }

  if (Object.keys(update).length === 0) return ok(field)
  const { data, error } = await ctx.db
    .from('custom_fields')
    .update(update)
    .eq('id', fieldId)
    .eq('account_id', ctx.accountId)
    .select()
    .single()
  if (error) return fail(500, error.message)
  return ok(data as CustomFieldRow)
}

/** Fields (contact fields) that reference the given table key. */
async function fieldsReferencing(ctx: Ctx, tableKey: string): Promise<CustomFieldRow[]> {
  const { data } = await ctx.db
    .from('custom_fields')
    .select('*')
    .eq('account_id', ctx.accountId)
    .eq('field_type', 'reference')
    .is('archived_at', null)
  return ((data ?? []) as CustomFieldRow[]).filter(
    (f) => f.field_options?.table_key === tableKey,
  )
}

/**
 * Delete a field. Fields with stored values are archived (recoverable);
 * `purge` removes the field and every stored value for good.
 */
export async function deleteField(
  ctx: Ctx,
  fieldId: string,
  opts: { purge?: boolean } = {},
): Promise<Result<{ archived: boolean }>> {
  if (!hasMinRole(ctx.role, 'admin')) return fail(403, 'Only admins can delete fields')
  const { data: current } = await ctx.db
    .from('custom_fields')
    .select('*')
    .eq('id', fieldId)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!current) return fail(404, 'Field not found')
  const field = current as CustomFieldRow
  if (field.locked) return fail(403, 'This field is managed by an app')

  if (!opts.purge) {
    const { count } = await ctx.db
      .from('contact_custom_values')
      .select('id', { count: 'exact', head: true })
      .eq('custom_field_id', fieldId)
    if ((count ?? 0) > 0) {
      const { error } = await ctx.db
        .from('custom_fields')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', fieldId)
        .eq('account_id', ctx.accountId)
      if (error) return fail(500, error.message)
      return ok({ archived: true })
    }
  }
  const { error } = await ctx.db
    .from('custom_fields')
    .delete()
    .eq('id', fieldId)
    .eq('account_id', ctx.accountId)
  if (error) return fail(500, error.message)
  return ok({ archived: false })
}

// ------------------------------------------------------------
// Tables
// ------------------------------------------------------------

export interface TableColumnInput {
  name: string
  key?: string
  type: FieldType
  options?: FieldOptions
  required?: boolean
}

export interface TableInput {
  name?: unknown
  key?: unknown
  description?: unknown
  columns?: unknown
  label_field_key?: unknown
  min_role_edit?: unknown
  source?: unknown
  locked?: unknown
}

export interface TableSummary extends CustomTableRow {
  column_count: number
  row_count: number
}

export async function listTables(ctx: Ctx): Promise<Result<TableSummary[]>> {
  const { data: tables, error } = await ctx.db
    .from('custom_tables')
    .select('*')
    .eq('account_id', ctx.accountId)
    .is('archived_at', null)
    .order('created_at')
  if (error) return fail(500, error.message)
  const rows = (tables ?? []) as CustomTableRow[]
  const out: TableSummary[] = []
  for (const t of rows) {
    const [{ count: cols }, { count: recs }] = await Promise.all([
      ctx.db
        .from('custom_fields')
        .select('id', { count: 'exact', head: true })
        .eq('table_id', t.id)
        .is('archived_at', null),
      ctx.db.from('custom_records').select('id', { count: 'exact', head: true }).eq('table_id', t.id),
    ])
    out.push({ ...t, column_count: cols ?? 0, row_count: recs ?? 0 })
  }
  return ok(out)
}

export async function getTable(
  ctx: Ctx,
  idOrKey: string,
): Promise<Result<{ table: CustomTableRow; columns: CustomFieldRow[] }>> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrKey)
  const { data: table } = await ctx.db
    .from('custom_tables')
    .select('*')
    .eq('account_id', ctx.accountId)
    .eq(isUuid ? 'id' : 'key', idOrKey)
    .maybeSingle()
  if (!table) return fail(404, 'Table not found')
  const cols = await listFields(ctx, { tableId: (table as CustomTableRow).id })
  if (!cols.ok) return cols
  return ok({ table: table as CustomTableRow, columns: cols.data })
}

export async function createTable(
  ctx: Ctx,
  input: TableInput,
): Promise<Result<{ table: CustomTableRow; columns: CustomFieldRow[] }>> {
  if (!hasMinRole(ctx.role, 'admin')) return fail(403, 'Only admins can create tables')
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return fail(400, 'Table name is required')
  if (name.length > 80) return fail(400, 'Table name is too long')
  const columns = Array.isArray(input.columns) ? (input.columns as TableColumnInput[]) : []
  if (columns.length === 0) return fail(400, 'Add at least one column')
  if (columns.length > 30) return fail(400, 'A table can have at most 30 columns')
  for (const c of columns) {
    if (!c || typeof c.name !== 'string' || !c.name.trim()) return fail(400, 'Every column needs a name')
    if (!FIELD_TYPES.includes(c.type)) return fail(400, `Unknown type for column "${c.name}"`)
    const check = validateFieldOptions(c.type, c.options)
    if (!check.ok) return fail(400, `${c.name}: ${check.error}`)
  }
  const names = new Set<string>()
  for (const c of columns) {
    const k = c.name.trim().toLowerCase()
    if (names.has(k)) return fail(400, `Duplicate column "${c.name.trim()}"`)
    names.add(k)
  }

  const wantedKey =
    typeof input.key === 'string' && input.key ? input.key : slugifyKey(name)
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(wantedKey)) return fail(400, 'Invalid table key')

  return gated(async () => {
    await assertFeature(ctx.db, ctx.accountId, 'custom_fields')
    const { count } = await ctx.db
      .from('custom_tables')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
      .is('archived_at', null)
    await assertWithinLimit(ctx.db, ctx.accountId, 'custom_tables_max', count ?? 0)

    const { data: clash } = await ctx.db
      .from('custom_tables')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('key', wantedKey)
      .maybeSingle()
    if (clash) return fail(409, `A table with key "${wantedKey}" already exists`)

    const role = input.min_role_edit
    if (role !== undefined && !(isAccountRole(role) && role !== 'viewer')) {
      return fail(400, 'Invalid role')
    }

    const { data: table, error } = await ctx.db
      .from('custom_tables')
      .insert({
        account_id: ctx.accountId,
        key: wantedKey,
        name,
        description:
          typeof input.description === 'string' ? input.description.trim() || null : null,
        min_role_edit: role ?? 'agent',
        source: typeof input.source === 'string' ? input.source : null,
        locked: input.locked === true,
        created_by: ctx.userId,
      })
      .select()
      .single()
    if (error) return fail(500, error.message)
    const created = table as CustomTableRow

    const made: CustomFieldRow[] = []
    for (const c of columns) {
      const res = await createField(ctx, {
        name: c.name,
        key: c.key,
        type: c.type,
        options: c.options,
        required: c.required,
        table_id: created.id,
        source: input.source,
        locked: input.locked,
      })
      if (!res.ok) {
        // Roll the half-built table back so a retry starts clean.
        await ctx.db.from('custom_tables').delete().eq('id', created.id)
        return fail(res.status, `${c.name}: ${res.error}`)
      }
      made.push(res.data)
    }

    const labelKey =
      typeof input.label_field_key === 'string' &&
      made.some((f) => f.key === input.label_field_key)
        ? input.label_field_key
        : made[0].key
    const { data: withLabel } = await ctx.db
      .from('custom_tables')
      .update({ label_field_key: labelKey })
      .eq('id', created.id)
      .select()
      .single()
    return ok({ table: (withLabel ?? created) as CustomTableRow, columns: made })
  })
}

export async function updateTable(
  ctx: Ctx,
  tableId: string,
  patch: { name?: unknown; description?: unknown; label_field_key?: unknown; min_role_edit?: unknown },
): Promise<Result<CustomTableRow>> {
  if (!hasMinRole(ctx.role, 'admin')) return fail(403, 'Only admins can edit tables')
  const found = await getTable(ctx, tableId)
  if (!found.ok) return found
  const { table, columns } = found.data
  const update: Record<string, unknown> = {}
  if (!table.locked) {
    if (patch.name !== undefined) {
      const name = typeof patch.name === 'string' ? patch.name.trim() : ''
      if (!name || name.length > 80) return fail(400, 'Invalid table name')
      update.name = name
    }
    if (patch.min_role_edit !== undefined) {
      if (!(isAccountRole(patch.min_role_edit) && patch.min_role_edit !== 'viewer')) {
        return fail(400, 'Invalid role')
      }
      update.min_role_edit = patch.min_role_edit
    }
    if (patch.label_field_key !== undefined) {
      if (!columns.some((c) => c.key === patch.label_field_key)) {
        return fail(400, 'Label column not found')
      }
      update.label_field_key = patch.label_field_key
    }
  }
  if (patch.description !== undefined) {
    update.description = typeof patch.description === 'string' ? patch.description.trim() || null : null
  }
  if (Object.keys(update).length === 0) return ok(table)
  const { data, error } = await ctx.db
    .from('custom_tables')
    .update(update)
    .eq('id', tableId)
    .eq('account_id', ctx.accountId)
    .select()
    .single()
  if (error) return fail(500, error.message)
  return ok(data as CustomTableRow)
}

export async function deleteTable(ctx: Ctx, tableId: string): Promise<Result<{ deleted: true }>> {
  if (!hasMinRole(ctx.role, 'admin')) return fail(403, 'Only admins can delete tables')
  const found = await getTable(ctx, tableId)
  if (!found.ok) return found
  const { table } = found.data
  if (table.locked) return fail(403, 'This table is managed by an app')

  const refs = await fieldsReferencing(ctx, table.key)
  if (refs.length > 0) {
    return fail(
      409,
      `Remove the "${refs.map((r) => r.field_name).join('", "')}" field first. It points at this table.`,
    )
  }
  const { error } = await ctx.db
    .from('custom_tables')
    .delete()
    .eq('id', tableId)
    .eq('account_id', ctx.accountId)
  if (error) return fail(500, error.message)
  return ok({ deleted: true })
}

// ------------------------------------------------------------
// Rows
// ------------------------------------------------------------

export interface RecordRow {
  id: string
  table_id: string
  label: string
  data: Record<string, unknown>
  created_at: string
  updated_at: string
}

function canEditRows(ctx: Ctx, table: CustomTableRow): boolean {
  return hasMinRole(ctx.role, table.min_role_edit)
}

/** Validate a row's raw values against the table's columns. */
function buildRecordData(
  columns: CustomFieldRow[],
  labelKey: string | null,
  values: Record<string, unknown>,
  existing: Record<string, unknown> = {},
  accountId?: string,
): Result<{ data: Record<string, unknown>; label: string }> {
  const data: Record<string, unknown> = { ...existing }
  for (const col of columns) {
    if (!(col.key in values)) continue
    const res = coerceValue(col, values[col.key], { accountId })
    if (!res.ok) return fail(400, res.error)
    if (res.clear) delete data[col.key]
    else {
      const v = res.value
      data[col.key] =
        col.field_type === 'number'
          ? v.value_number
          : col.field_type === 'bool'
            ? v.value_bool
            : col.field_type === 'multi_enum'
              ? v.value_text_array
              : v.value
    }
  }
  // Required columns must end up set.
  for (const col of columns) {
    if (col.required && (data[col.key] === undefined || data[col.key] === null || data[col.key] === '')) {
      return fail(400, `${col.field_name} is required`)
    }
  }
  const labelRaw = labelKey ? data[labelKey] : undefined
  const label = Array.isArray(labelRaw) ? labelRaw.join(', ') : labelRaw == null ? '' : String(labelRaw)
  return ok({ data, label })
}

export async function listRecords(
  ctx: Ctx,
  tableId: string,
  opts: { search?: string; limit?: number; offset?: number; ids?: string[] } = {},
): Promise<Result<{ records: RecordRow[]; total: number }>> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const offset = Math.max(opts.offset ?? 0, 0)
  const found = await getTable(ctx, tableId)
  if (!found.ok) return found
  tableId = found.data.table.id
  let q = ctx.db
    .from('custom_records')
    .select('id, table_id, label, data, created_at, updated_at', { count: 'exact' })
    .eq('account_id', ctx.accountId)
    .eq('table_id', tableId)
  if (opts.ids && opts.ids.length > 0) q = q.in('id', opts.ids.slice(0, 100))
  if (opts.search?.trim()) {
    q = q.ilike('label', `%${opts.search.trim().replace(/[%_]/g, '\\$&')}%`)
  }
  const { data, error, count } = await q
    .order('label')
    .order('created_at')
    .range(offset, offset + limit - 1)
  if (error) return fail(500, error.message)
  return ok({ records: (data ?? []) as RecordRow[], total: count ?? 0 })
}

export async function createRecord(
  ctx: Ctx,
  tableId: string,
  values: Record<string, unknown>,
): Promise<Result<RecordRow>> {
  const found = await getTable(ctx, tableId)
  if (!found.ok) return found
  const { table, columns } = found.data
  if (!canEditRows(ctx, table)) return fail(403, 'You do not have permission to edit this table')
  tableId = table.id

  return gated(async () => {
    await assertFeature(ctx.db, ctx.accountId, 'custom_fields')
    const { count } = await ctx.db
      .from('custom_records')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
    await assertWithinLimit(ctx.db, ctx.accountId, 'custom_records_max', count ?? 0)

    const built = buildRecordData(columns, table.label_field_key, values, {}, ctx.accountId)
    if (!built.ok) return built
    const { data, error } = await ctx.db
      .from('custom_records')
      .insert({
        account_id: ctx.accountId,
        table_id: tableId,
        label: built.data.label,
        data: built.data.data,
        created_by: ctx.userId,
      })
      .select('id, table_id, label, data, created_at, updated_at')
      .single()
    if (error) return fail(500, error.message)
    return ok(data as RecordRow)
  })
}

export async function updateRecord(
  ctx: Ctx,
  tableId: string,
  recordId: string,
  values: Record<string, unknown>,
): Promise<Result<RecordRow>> {
  const found = await getTable(ctx, tableId)
  if (!found.ok) return found
  const { table, columns } = found.data
  if (!canEditRows(ctx, table)) return fail(403, 'You do not have permission to edit this table')
  tableId = table.id

  const { data: current } = await ctx.db
    .from('custom_records')
    .select('id, data')
    .eq('id', recordId)
    .eq('table_id', tableId)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!current) return fail(404, 'Row not found')

  const built = buildRecordData(
    columns,
    table.label_field_key,
    values,
    (current as { data: Record<string, unknown> }).data,
    ctx.accountId,
  )
  if (!built.ok) return built
  const { data, error } = await ctx.db
    .from('custom_records')
    .update({ label: built.data.label, data: built.data.data, updated_at: new Date().toISOString() })
    .eq('id', recordId)
    .eq('account_id', ctx.accountId)
    .select('id, table_id, label, data, created_at, updated_at')
    .single()
  if (error) return fail(500, error.message)
  return ok(data as RecordRow)
}

/** How many contacts point at this row through a reference field. */
export async function countRecordUsage(
  ctx: Ctx,
  table: CustomTableRow,
  recordId: string,
): Promise<number> {
  const refs = await fieldsReferencing(ctx, table.key)
  if (refs.length === 0) return 0
  const { count } = await ctx.db
    .from('contact_custom_values')
    .select('id', { count: 'exact', head: true })
    .in('custom_field_id', refs.map((r) => r.id))
    .eq('value', recordId)
  return count ?? 0
}

export async function deleteRecord(
  ctx: Ctx,
  tableId: string,
  recordId: string,
): Promise<Result<{ cleared_contacts: number }>> {
  const found = await getTable(ctx, tableId)
  if (!found.ok) return found
  const { table } = found.data
  if (!canEditRows(ctx, table)) return fail(403, 'You do not have permission to edit this table')
  tableId = table.id

  // Clear contact values that point at this row first so no contact is
  // left referencing something that no longer exists.
  const refs = await fieldsReferencing(ctx, table.key)
  let cleared = 0
  if (refs.length > 0) {
    const { data: gone } = await ctx.db
      .from('contact_custom_values')
      .delete()
      .in('custom_field_id', refs.map((r) => r.id))
      .eq('value', recordId)
      .select('id')
    cleared = gone?.length ?? 0
  }
  const { error } = await ctx.db
    .from('custom_records')
    .delete()
    .eq('id', recordId)
    .eq('table_id', tableId)
    .eq('account_id', ctx.accountId)
  if (error) return fail(500, error.message)
  return ok({ cleared_contacts: cleared })
}
