import { createField, createTable, type Ctx } from '@/lib/custom-fields/server'
import { createSegment, type SegCtx } from '@/lib/segments/server'
import { isGroup, type FilterGroup, type FilterRule } from '@/lib/segments/types'
import type { ApplyPackResult, FieldPack } from './types'

/** Replace `cf:@<field key>` in a pack segment's rules with real field ids. */
export function resolvePackFilter(filter: FilterGroup, idByKey: Map<string, string>): FilterGroup {
  const walk = (item: FilterRule | FilterGroup): FilterRule | FilterGroup => {
    if (isGroup(item)) return { ...item, rules: item.rules.map(walk) }
    if (item.field.startsWith('cf:@')) {
      const id = idByKey.get(item.field.slice(4))
      return { ...item, field: id ? `cf:${id}` : item.field }
    }
    return item
  }
  return { ...filter, rules: filter.rules.map(walk) }
}

/**
 * Install a pack into an account. Idempotent: anything that already exists
 * (matched by key / name) is left alone and reported, so re-applying a pack
 * after an app update only adds what is new. Created items are tagged with
 * `source = pack.key` and locked, so a user can't rename or delete what the
 * app relies on, and the app can find what it owns later.
 *
 * Tables go first so reference fields can point at them.
 */
export async function applyPack(ctx: Ctx & SegCtx, pack: FieldPack): Promise<ApplyPackResult> {
  const out: ApplyPackResult = {
    fieldsCreated: [],
    fieldsExisting: [],
    tablesCreated: [],
    tablesExisting: [],
    segmentsCreated: [],
    segmentsExisting: [],
    errors: [],
  }

  for (const table of pack.tables ?? []) {
    const { data: existing } = await ctx.db
      .from('custom_tables')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('key', table.key)
      .maybeSingle()
    if (existing) {
      out.tablesExisting.push(table.key)
      continue
    }
    const res = await createTable(ctx, {
      key: table.key,
      name: table.name,
      label_field_key: table.label_field_key,
      columns: table.columns,
      source: pack.key,
      locked: true,
    })
    if (res.ok) out.tablesCreated.push(table.key)
    else out.errors.push(`table ${table.key}: ${res.error}`)
  }

  const { data: existingFields } = await ctx.db
    .from('custom_fields')
    .select('id, key')
    .eq('account_id', ctx.accountId)
    .is('table_id', null)
  const idByKey = new Map<string, string>(
    ((existingFields ?? []) as { id: string; key: string }[]).map((f) => [f.key, f.id]),
  )

  for (const field of pack.fields) {
    if (idByKey.has(field.key)) {
      out.fieldsExisting.push(field.key)
      continue
    }
    const res = await createField(ctx, {
      key: field.key,
      name: field.name,
      type: field.type,
      options: field.options ?? {},
      show_in_table: field.show_in_table,
      description: field.description,
      source: pack.key,
      locked: true,
    })
    if (res.ok) {
      out.fieldsCreated.push(field.key)
      idByKey.set(field.key, res.data.id)
    } else {
      out.errors.push(`field ${field.key}: ${res.error}`)
    }
  }

  for (const seg of pack.segments ?? []) {
    const { data: existing } = await ctx.db
      .from('segments')
      .select('id')
      .eq('account_id', ctx.accountId)
      .ilike('name', seg.name.replace(/[%_]/g, '\\$&'))
      .maybeSingle()
    if (existing) {
      out.segmentsExisting.push(seg.name)
      continue
    }
    const res = await createSegment(ctx, {
      name: seg.name,
      description: seg.description,
      filter: resolvePackFilter(seg.filter, idByKey),
      source: pack.key,
      locked: true,
    })
    if (res.ok) out.segmentsCreated.push(seg.name)
    else out.errors.push(`segment ${seg.name}: ${res.error}`)
  }

  return out
}
