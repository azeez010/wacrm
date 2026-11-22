import { coerceValue } from '@/lib/custom-fields/coerce'
import type { FieldDef } from '@/lib/custom-fields/types'
import { normalizeFormPhone } from './countries'
import type { FormField } from './types'

/** A contact custom field the form can write (needs its key for the writer). */
export type FormCustomField = FieldDef & { key: string }

export interface FormValidationContext {
  accountId: string
  defaultCountry?: string | null
  /** Non-table contact custom fields by id. */
  customFields: Map<string, FormCustomField>
  /** Custom-table columns by `<referenceFieldId>:<columnKey>`. */
  tableColumns: Map<string, FieldDef>
  now?: Date
}

export interface ValidatedAnswers {
  ok: boolean
  /** field id -> message (shown next to that field). */
  errors: Record<string, string>
  phone: string | null
  name?: string
  email?: string
  company?: string
  message?: string
  /** custom field key -> raw answer, ready for `writeContactCustomFields`. */
  customByKey: Record<string, unknown>
  /** reference field id -> column key -> text (for `bulkResolveRecords`). */
  tableRows: Record<string, Record<string, string>>
  /** Tag ids the visitor picked (only ones the form allows). */
  tagIds: string[]
  consent: { text: string; privacyUrl?: string; at: string } | null
  /** field id -> { label, value } so old submissions stay readable after edits. */
  snapshot: Record<string, { label: string; value: unknown }>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function isEmptyAnswer(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

function truthy(v: unknown): boolean {
  return v === true || v === 'true' || v === 'on' || v === 'yes' || v === '1' || v === 1
}

/** Options the form allows for a choice field, or null when unrestricted. */
function inSubset(field: FormField, raw: unknown): boolean {
  if (!field.options || field.options.length === 0) return true
  const allowed = new Set(field.options.map((o) => o.toLowerCase()))
  const picks = Array.isArray(raw) ? raw : [raw]
  return picks.every((p) => allowed.has(String(p).trim().toLowerCase()))
}

/**
 * Validate a public submission against the form definition. Only fields defined
 * on the form are read; everything else in `answers` is ignored (a visitor cannot
 * invent field ids, tag ids or contact columns).
 */
export function validateAnswers(
  fields: FormField[],
  answers: Record<string, unknown>,
  ctx: FormValidationContext,
): ValidatedAnswers {
  const out: ValidatedAnswers = {
    ok: true,
    errors: {},
    phone: null,
    customByKey: {},
    tableRows: {},
    tagIds: [],
    consent: null,
    snapshot: {},
  }
  const fail = (id: string, msg: string) => {
    out.errors[id] = msg
    out.ok = false
  }
  const now = ctx.now ?? new Date()

  for (const f of fields) {
    const raw = answers[f.id]
    const empty = isEmptyAnswer(raw)
    const label = f.label || f.kind

    switch (f.kind) {
      case 'heading':
        break

      case 'phone': {
        // Always required, whatever the stored flag says.
        if (empty) {
          fail(f.id, 'required')
          break
        }
        const p = normalizeFormPhone(raw, ctx.defaultCountry)
        if (!p) fail(f.id, 'invalid_phone')
        else {
          out.phone = p
          out.snapshot[f.id] = { label, value: p }
        }
        break
      }

      case 'name':
      case 'company':
      case 'message': {
        if (empty) {
          if (f.required) fail(f.id, 'required')
          break
        }
        const max = f.kind === 'message' ? 2000 : 120
        const s = String(raw).trim().slice(0, max)
        if (f.kind === 'name') out.name = s
        else if (f.kind === 'company') out.company = s
        else out.message = s
        out.snapshot[f.id] = { label, value: s }
        break
      }

      case 'email': {
        if (empty) {
          if (f.required) fail(f.id, 'required')
          break
        }
        const s = String(raw).trim().toLowerCase()
        if (!EMAIL_RE.test(s) || s.length > 254) fail(f.id, 'invalid_email')
        else {
          out.email = s
          out.snapshot[f.id] = { label, value: s }
        }
        break
      }

      case 'custom_field': {
        const def = f.customFieldId ? ctx.customFields.get(f.customFieldId) : undefined
        if (!def) {
          // Field deleted/archived since the form was built: ignore it, never fail the visitor.
          break
        }
        if (empty && !f.required) break
        if (!empty && !inSubset(f, raw)) {
          fail(f.id, 'invalid_choice')
          break
        }
        const res = coerceValue({ ...def, required: !!f.required }, raw, { accountId: ctx.accountId })
        if (!res.ok) {
          fail(f.id, res.error)
          break
        }
        if (res.clear) break
        out.customByKey[def.key] = raw
        out.snapshot[f.id] = { label, value: raw }
        break
      }

      case 'table_column': {
        const ref = f.tableRef
        const def = ref ? ctx.tableColumns.get(`${ref.fieldId}:${ref.columnKey}`) : undefined
        if (!ref || !def) break
        if (empty && !f.required) break
        if (!empty && !inSubset(f, raw)) {
          fail(f.id, 'invalid_choice')
          break
        }
        const res = coerceValue({ ...def, required: !!f.required }, raw, { accountId: ctx.accountId })
        if (!res.ok) {
          fail(f.id, res.error)
          break
        }
        if (res.clear) break
        const text = Array.isArray(raw) ? raw.join('; ') : String(raw)
        ;(out.tableRows[ref.fieldId] ??= {})[ref.columnKey] = text
        out.snapshot[f.id] = { label, value: raw }
        break
      }

      case 'tag_picker': {
        const allowed = new Set(f.tagIds ?? [])
        const picks = (Array.isArray(raw) ? raw : empty ? [] : [raw]).map(String)
        const valid = picks.filter((id) => allowed.has(id))
        if (f.required && valid.length === 0) {
          fail(f.id, 'required')
          break
        }
        out.tagIds.push(...valid)
        if (valid.length > 0) out.snapshot[f.id] = { label, value: valid }
        break
      }

      case 'consent': {
        const ticked = truthy(raw)
        if (!ticked) {
          if (f.required) fail(f.id, 'required')
          break
        }
        out.consent = {
          text: f.consentText || label,
          privacyUrl: f.privacyUrl,
          at: now.toISOString(),
        }
        out.snapshot[f.id] = { label, value: true }
        break
      }

      case 'hidden': {
        // Value comes from the URL parameter the page prefilled, or a fixed value.
        const v = f.fixedValue ?? (typeof raw === 'string' ? raw.trim().slice(0, 300) : '')
        if (v) out.snapshot[f.id] = { label: f.param || label, value: v }
        break
      }
    }
  }

  // A hidden field can map onto a custom field of the same id only through
  // custom_field kind, so hidden values stay in the snapshot, never on contacts.
  out.tagIds = [...new Set(out.tagIds)]
  return out
}
