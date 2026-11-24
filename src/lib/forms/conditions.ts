// ============================================================
// Conditional form fields: "show this field only if ...".
//
// A field may carry `visibleWhen`: one or more rules that look at the answers
// to EARLIER fields. The same pure code runs in the visitor's browser (to show
// and hide fields live), in the editor preview, and on the server (so a field
// that is hidden is never required and its answer is ignored).
// ============================================================

export const CONDITION_OPS = ['eq', 'neq', 'contains', 'filled', 'empty', 'gt', 'lt'] as const
export type ConditionOp = (typeof CONDITION_OPS)[number]

/** Operators that need a value to compare against. */
export const OPS_WITH_VALUE: readonly ConditionOp[] = ['eq', 'neq', 'contains', 'gt', 'lt']

export const MAX_CONDITION_RULES = 5

export interface ConditionRule {
  /** The earlier field whose answer is checked. */
  fieldId: string
  op: ConditionOp
  value?: string
}

export interface VisibleWhen {
  /** 'all' = every rule must hold, 'any' = at least one. */
  match: 'all' | 'any'
  rules: ConditionRule[]
}

export interface ConditionalField {
  id: string
  kind?: string
  visibleWhen?: VisibleWhen
}

/** Kinds whose answer can be tested. (Tag picks, fixed values and the phone number are not useful sources.) */
const NON_SOURCE_KINDS = new Set(['heading', 'hidden', 'tag_picker', 'phone'])
/** The phone field is always required, so it can never be conditional. */
const NEVER_CONDITIONAL_KINDS = new Set(['phone'])

export const canBeConditionSource = (kind: string | undefined): boolean => !NON_SOURCE_KINDS.has(kind ?? '')
export const canBeConditional = (kind: string | undefined): boolean => !NEVER_CONDITIONAL_KINDS.has(kind ?? '')

/** An answer as a list of comparable strings (empty list = not answered). */
export function answerValues(raw: unknown): string[] {
  if (raw === undefined || raw === null) return []
  if (typeof raw === 'boolean') return [raw ? 'true' : 'false']
  if (typeof raw === 'number') return Number.isFinite(raw) ? [String(raw)] : []
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean)
  const s = String(raw).trim()
  return s ? [s] : []
}

export function ruleHolds(rule: ConditionRule, raw: unknown): boolean {
  const values = answerValues(raw)
  const want = (rule.value ?? '').trim().toLowerCase()
  const lower = values.map((v) => v.toLowerCase())
  switch (rule.op) {
    case 'filled':
      return values.length > 0
    case 'empty':
      return values.length === 0
    case 'eq':
      return lower.includes(want)
    case 'neq':
      return !lower.includes(want)
    case 'contains':
      return want !== '' && lower.some((v) => v.includes(want))
    case 'gt':
    case 'lt': {
      const a = Number(values[0])
      const b = Number(rule.value)
      if (values.length === 0 || !Number.isFinite(a) || !Number.isFinite(b)) return false
      return rule.op === 'gt' ? a > b : a < b
    }
    default:
      return false
  }
}

/**
 * Which fields are visible for these answers. Evaluated top to bottom, and a field
 * hidden by its own condition counts as unanswered for the fields below it, so
 * chains ("B only if A is yes", "C only if B is filled") behave sensibly.
 * A rule pointing at a missing field simply sees "no answer".
 */
export function computeVisibility(fields: readonly ConditionalField[], answers: Record<string, unknown>): Record<string, boolean> {
  const visible: Record<string, boolean> = {}
  for (const f of fields) {
    const when = f.visibleWhen
    if (!when || when.rules.length === 0) {
      visible[f.id] = true
      continue
    }
    const results = when.rules.map((r) => ruleHolds(r, visible[r.fieldId] === false ? undefined : answers[r.fieldId]))
    visible[f.id] = when.match === 'any' ? results.some(Boolean) : results.every(Boolean)
  }
  return visible
}

/**
 * Problems with the conditions on a form's fields, for the API to reject:
 * rules must point at an earlier, testable field, and carry a value when the
 * operator needs one. Returns the first problem, or null.
 */
export function findConditionProblem(fields: readonly ConditionalField[]): { index: number; message: string } | null {
  const earlier = new Map<string, string | undefined>()
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]
    if (f.visibleWhen) {
      if (!canBeConditional(f.kind)) return { index: i, message: 'This field cannot be conditional' }
      for (const r of f.visibleWhen.rules) {
        if (!earlier.has(r.fieldId)) return { index: i, message: `Condition refers to "${r.fieldId}", which is not an earlier field` }
        if (!canBeConditionSource(earlier.get(r.fieldId))) return { index: i, message: `Condition cannot test "${r.fieldId}"` }
        if (OPS_WITH_VALUE.includes(r.op) && !(r.value ?? '').trim()) return { index: i, message: 'Condition needs a value' }
      }
    }
    earlier.set(f.id, f.kind)
  }
  return null
}

/**
 * Drop rules that no longer point at an earlier, testable field (after a field is
 * removed or moved) and remove the condition entirely when no rules are left.
 */
export function sanitizeConditions<T extends ConditionalField>(fields: readonly T[]): T[] {
  const earlier = new Map<string, string | undefined>()
  const out: T[] = []
  for (const f of fields) {
    let next = f
    if (f.visibleWhen) {
      const rules = f.visibleWhen.rules.filter((r) => earlier.has(r.fieldId) && canBeConditionSource(earlier.get(r.fieldId)))
      if (!canBeConditional(f.kind) || rules.length === 0) {
        const { visibleWhen: _drop, ...rest } = f
        void _drop
        next = rest as T
      } else if (rules.length !== f.visibleWhen.rules.length) {
        next = { ...f, visibleWhen: { ...f.visibleWhen, rules } }
      }
    }
    out.push(next)
    earlier.set(f.id, f.kind)
  }
  return out
}
