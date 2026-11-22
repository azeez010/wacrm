// ============================================================
// Shared types for typed custom fields and custom tables.
//
// `value TEXT` on contact_custom_values stays the canonical stored
// value; the typed shadow columns (number / date / bool / text[]) are
// derived from it by `coerceValue` and are what filters query.
// ============================================================

export const FIELD_TYPES = [
  'text',
  'number',
  'bool',
  'date',
  'enum',
  'multi_enum',
  'reference',
  'media',
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

export type NumberFormat = 'plain' | 'currency' | 'percent'

/** Per-type configuration stored in custom_fields.field_options. */
export interface FieldOptions {
  /** enum / multi_enum */
  options?: string[]
  /** number */
  format?: NumberFormat
  currency?: string
  min?: number
  max?: number
  /** date: store/show a time of day as well */
  include_time?: boolean
  /** reference: key of the custom table the value points into */
  table_key?: string
  /** media: which kind of file the field accepts (default any) */
  accept?: MediaAccept
}

export const MEDIA_ACCEPT_VALUES = ['any', 'image', 'document', 'video', 'audio'] as const
export type MediaAccept = (typeof MEDIA_ACCEPT_VALUES)[number]

/** What a media field stores (as JSON text in `contact_custom_values.value`). */
export interface MediaValue {
  /** Public URL of the uploaded file. */
  url: string
  /** Storage object path, `account-<id>/custom-fields/...` (used to delete the file). */
  path: string
  name: string
  mime: string
  size: number
}

/** The slice of a custom_fields row the validator and filters need. */
export interface FieldDef {
  id: string
  key: string
  field_name: string
  field_type: FieldType
  field_options?: FieldOptions | null
  required?: boolean
  default_value?: string | null
}

/** Typed shadow columns derived from a raw value. */
export interface TypedColumns {
  value_number: number | null
  value_date: string | null
  value_bool: boolean | null
  value_text_array: string[] | null
}

export interface CoercedValue extends TypedColumns {
  /** Canonical text stored in contact_custom_values.value. */
  value: string
}

export type CoerceResult =
  | { ok: true; clear: true }
  | { ok: true; clear: false; value: CoercedValue }
  | { ok: false; error: string }

export const MAX_TEXT_LENGTH = 2000
export const MAX_OPTIONS = 200
export const MAX_OPTION_LENGTH = 100

/** Keys that would collide with built-in contact columns. */
export const RESERVED_FIELD_KEYS = new Set([
  'id',
  'name',
  'phone',
  'email',
  'company',
  'tags',
  'created_at',
  'updated_at',
])
