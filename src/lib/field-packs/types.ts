import type { FieldOptions, FieldType } from '@/lib/custom-fields/types'
import type { FilterGroup } from '@/lib/segments/types'

/**
 * A field pack is plain data describing custom fields, custom tables and
 * segments that an "app" (e.g. a gym app) installs into an account. There
 * is no UI for packs yet; `applyPack` is what a future app will call.
 */
export interface PackField {
  key: string
  name: string
  type: FieldType
  options?: FieldOptions
  show_in_table?: boolean
  description?: string
}

export interface PackTable {
  key: string
  name: string
  label_field_key?: string
  columns: { key: string; name: string; type: FieldType; options?: FieldOptions; required?: boolean }[]
}

export interface PackSegment {
  name: string
  description?: string
  /** Rules may reference pack fields as `cf:@<field key>`; resolved to ids on apply. */
  filter: FilterGroup
}

export interface FieldPack {
  key: string
  name: string
  fields: PackField[]
  tables?: PackTable[]
  segments?: PackSegment[]
}

export interface ApplyPackResult {
  fieldsCreated: string[]
  fieldsExisting: string[]
  tablesCreated: string[]
  tablesExisting: string[]
  segmentsCreated: string[]
  segmentsExisting: string[]
  errors: string[]
}
