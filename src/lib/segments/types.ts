// ============================================================
// Segment / filter types. One JSON shape, evaluated in Postgres by
// `filter_contacts` (migration 067) and mirrored here for the UI,
// validation and the API.
// ============================================================

export const FILTER_VERSION = 1 as const

export type FilterOperator =
  // text
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  // number / date
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  // bool
  | 'is_true'
  | 'is_false'
  // enum / reference
  | 'is'
  | 'is_not'
  | 'is_any_of'
  // multi-select / tags
  | 'has_any'
  | 'has_all'
  | 'has_none'
  // any
  | 'is_empty'
  | 'is_set'

export interface FilterRule {
  /** name | phone | email | company | created_at | tags | cf:<field id> */
  field: string
  operator: FilterOperator
  value?: unknown
}

export interface FilterGroup {
  version: typeof FILTER_VERSION
  op: 'and' | 'or'
  rules: Array<FilterRule | FilterGroup>
}

export interface Segment {
  id: string
  account_id: string
  name: string
  description: string | null
  filter: FilterGroup
  source: string | null
  locked: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

/** What the value editor for an operator looks like. */
export type ValueShape = 'none' | 'single' | 'pair' | 'list'

export const EMPTY_FILTER: FilterGroup = { version: FILTER_VERSION, op: 'and', rules: [] }

export function isGroup(item: FilterRule | FilterGroup): item is FilterGroup {
  return 'rules' in item
}
