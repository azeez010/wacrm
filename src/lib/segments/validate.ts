import { OPERATORS_BY_KIND, valueShape, type FilterFieldKind } from './operators'
import { FILTER_VERSION, isGroup, type FilterGroup, type FilterOperator, type FilterRule } from './types'

const BUILTIN_TEXT = new Set(['name', 'phone', 'email', 'company'])
const MAX_DEPTH = 4
const MAX_RULES = 50

/** Resolve the kind of a rule's field from the available custom-field kinds. */
export function kindOf(
  field: string,
  customKinds: Record<string, FilterFieldKind>,
): FilterFieldKind | null {
  if (BUILTIN_TEXT.has(field)) return 'builtin_text'
  if (field === 'created_at') return 'created_at'
  if (field === 'tags') return 'tags'
  if (field.startsWith('cf:')) return customKinds[field.slice(3)] ?? null
  return null
}

function hasValue(rule: FilterRule): boolean {
  const shape = valueShape(rule.operator)
  const v = rule.value
  if (shape === 'none') return true
  if (shape === 'list') return Array.isArray(v) && v.length > 0
  if (shape === 'pair') return Array.isArray(v) && v.length === 2 && v.every((x) => x !== '' && x != null)
  return v !== undefined && v !== null && String(v).trim() !== ''
}

/**
 * Clean a filter before saving or sending: drop rules that are
 * unfinished (no value yet), reference unknown fields, or use an operator
 * the field doesn't support; collapse empty groups. Returns the same
 * versioned shape the database evaluates.
 */
export function normalizeFilter(
  group: FilterGroup | null | undefined,
  customKinds: Record<string, FilterFieldKind>,
  depth = 0,
): FilterGroup {
  const out: FilterGroup = { version: FILTER_VERSION, op: group?.op === 'or' ? 'or' : 'and', rules: [] }
  if (!group || !Array.isArray(group.rules) || depth > MAX_DEPTH) return out
  for (const item of group.rules.slice(0, MAX_RULES)) {
    if (isGroup(item)) {
      const nested = normalizeFilter(item, customKinds, depth + 1)
      if (nested.rules.length > 0) out.rules.push(nested)
      continue
    }
    const kind = kindOf(item.field, customKinds)
    if (!kind) continue
    if (!OPERATORS_BY_KIND[kind].includes(item.operator as FilterOperator)) continue
    if (!hasValue(item)) continue
    out.rules.push(item)
  }
  return out
}

/** Number of finished rules, used for the "Filter (n)" badge. */
export function countRules(group: FilterGroup | null | undefined): number {
  if (!group) return 0
  return group.rules.reduce((n, r) => n + (isGroup(r) ? countRules(r) : 1), 0)
}

/** Loose structural check for filters arriving from the API / MCP. */
export function parseFilter(input: unknown): { ok: true; filter: FilterGroup } | { ok: false; error: string } {
  if (input === undefined || input === null) {
    return { ok: true, filter: { version: FILTER_VERSION, op: 'and', rules: [] } }
  }
  const walk = (g: unknown, depth: number): string | null => {
    if (!g || typeof g !== 'object' || Array.isArray(g)) return 'filter must be an object'
    if (depth > MAX_DEPTH) return 'filter is nested too deeply'
    const grp = g as Record<string, unknown>
    if (grp.op !== undefined && grp.op !== 'and' && grp.op !== 'or') return "filter.op must be 'and' or 'or'"
    if (!Array.isArray(grp.rules)) return 'filter.rules must be an array'
    if (grp.rules.length > MAX_RULES) return `filter has more than ${MAX_RULES} rules`
    for (const r of grp.rules) {
      if (r && typeof r === 'object' && 'rules' in (r as object)) {
        const e = walk(r, depth + 1)
        if (e) return e
      } else {
        const rule = r as Record<string, unknown> | null
        if (!rule || typeof rule.field !== 'string' || typeof rule.operator !== 'string') {
          return 'every rule needs a string field and operator'
        }
      }
    }
    return null
  }
  const err = walk(input, 0)
  if (err) return { ok: false, error: err }
  const g = input as FilterGroup
  return { ok: true, filter: { version: FILTER_VERSION, op: g.op === 'or' ? 'or' : 'and', rules: g.rules } }
}
