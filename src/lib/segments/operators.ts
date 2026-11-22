import type { FieldType } from '@/lib/custom-fields/types'
import type { FilterOperator, ValueShape } from './types'

/** The kinds of field a rule can target (custom field types + built-ins). */
export type FilterFieldKind = FieldType | 'builtin_text' | 'created_at' | 'tags'

const ANY_EMPTY: FilterOperator[] = ['is_empty', 'is_set']

export const OPERATORS_BY_KIND: Record<FilterFieldKind, FilterOperator[]> = {
  builtin_text: ['contains', 'not_contains', 'equals', 'not_equals', ...ANY_EMPTY],
  text: ['contains', 'not_contains', 'equals', 'not_equals', ...ANY_EMPTY],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', ...ANY_EMPTY],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', ...ANY_EMPTY],
  created_at: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between'],
  bool: ['is_true', 'is_false', ...ANY_EMPTY],
  enum: ['is', 'is_not', 'is_any_of', ...ANY_EMPTY],
  multi_enum: ['has_any', 'has_all', 'has_none', ...ANY_EMPTY],
  reference: ['is', 'is_not', ...ANY_EMPTY],
  media: ANY_EMPTY,
  tags: ['has_any', 'has_all', 'has_none'],
}

export function valueShape(op: FilterOperator): ValueShape {
  switch (op) {
    case 'is_empty':
    case 'is_set':
    case 'is_true':
    case 'is_false':
      return 'none'
    case 'between':
      return 'pair'
    case 'is_any_of':
    case 'has_any':
    case 'has_all':
    case 'has_none':
      return 'list'
    default:
      return 'single'
  }
}

export function defaultOperator(kind: FilterFieldKind): FilterOperator {
  return OPERATORS_BY_KIND[kind][0]
}

/** Date values: a relative token or an absolute YYYY-MM-DD. */
export const RELATIVE_DATES = ['today', '-7d', '-30d', '-90d', '+7d', '+30d'] as const

export function isRelativeDate(v: unknown): boolean {
  return typeof v === 'string' && /^(today|yesterday|tomorrow|[+-]\d{1,5}[dwmy])$/.test(v)
}
