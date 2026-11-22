import { coerceValue } from './coerce'
import type { FieldDef, TypedColumns } from './types'

/** A contact_custom_values row ready to upsert. */
export interface TypedValueRow extends TypedColumns {
  contact_id: string
  custom_field_id: string
  value: string
}

export interface TypedValueWritePlan {
  upserts: TypedValueRow[]
  clearedFieldIds: string[]
  /** Per-field validation errors, keyed by field id. Nothing is written for these. */
  errors: Record<string, string>
}

/**
 * Typed replacement for `planCustomValueWrites`: validates every value
 * against its field definition and produces rows that include the typed
 * shadow columns. Unknown field ids are ignored (the field may have been
 * deleted while the form was open).
 */
export function planTypedValueWrites(
  contactId: string,
  fields: FieldDef[],
  values: Record<string, unknown>,
  ctx: { accountId?: string } = {}
): TypedValueWritePlan {
  const byId = new Map(fields.map((f) => [f.id, f]))
  const plan: TypedValueWritePlan = { upserts: [], clearedFieldIds: [], errors: {} }

  for (const [fieldId, raw] of Object.entries(values)) {
    const field = byId.get(fieldId)
    if (!field) continue
    const result = coerceValue(field, raw, ctx)
    if (!result.ok) {
      plan.errors[fieldId] = result.error
    } else if (result.clear) {
      plan.clearedFieldIds.push(fieldId)
    } else {
      plan.upserts.push({
        contact_id: contactId,
        custom_field_id: fieldId,
        ...result.value,
      })
    }
  }
  return plan
}
