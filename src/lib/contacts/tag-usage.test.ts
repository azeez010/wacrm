import { describe, expect, it } from 'vitest'
import { collectTagUsage, filterUsesTag } from './tag-usage'
import type { FilterGroup } from '@/lib/segments/types'

const T = 'tag-1'
const OTHER = 'tag-2'

const nested: FilterGroup = {
  version: 1,
  op: 'and',
  rules: [
    { field: 'name', operator: 'is_set' },
    { version: 1, op: 'or', rules: [{ field: 'tags', operator: 'has_any', value: [OTHER, T] }] },
  ],
}

describe('filterUsesTag', () => {
  it('finds the tag inside nested groups only for tags rules', () => {
    expect(filterUsesTag(nested, T)).toBe(true)
    expect(filterUsesTag(nested, 'nope')).toBe(false)
    expect(filterUsesTag({ version: 1, op: 'and', rules: [{ field: 'name', operator: 'equals', value: [T] }] }, T)).toBe(false)
    expect(filterUsesTag(null, T)).toBe(false)
  })
})

describe('collectTagUsage', () => {
  const base = { segments: [], automations: [], steps: [], nodes: [], broadcasts: [] }
  it('collects references from every source and ignores inactive or unrelated ones', () => {
    const usage = collectTagUsage(
      {
        segments: [
          { id: 's1', name: 'VIPs', filter: nested },
          { id: 's2', name: 'Other', filter: { version: 1, op: 'and', rules: [] } },
        ],
        automations: [
          { id: 'a1', name: 'Welcome', trigger_type: 'tag_added', trigger_config: { tag_id: T } },
          { id: 'a2', name: 'Else', trigger_type: 'tag_added', trigger_config: { tag_id: OTHER } },
        ],
        steps: [
          { automation_id: 'a3', step_type: 'condition', step_config: { subject: 'tag_presence', operand: T }, automation: { id: 'a3', name: 'Check', is_active: true } },
          { automation_id: 'a3', step_type: 'add_tag', step_config: { tag_id: T }, automation: { id: 'a3', name: 'Check', is_active: true } },
          { automation_id: 'a4', step_type: 'add_tag', step_config: { tag_id: T }, automation: { id: 'a4', name: 'Off', is_active: false } },
        ],
        nodes: [
          { node_type: 'set_tag', config: { tag_id: T }, flow: { id: 'f1', name: 'Menu', status: 'active' } },
          { node_type: 'condition', config: { subject: 'tag', subject_key: T }, flow: { id: 'f2', name: 'Draft flow', status: 'draft' } },
        ],
        broadcasts: [
          { id: 'b1', name: 'Promo', status: 'scheduled', audience_filter: { type: 'tags', tagIds: [T] } },
          { id: 'b2', name: 'Old', status: 'completed', audience_filter: { tagIds: [T] } },
          { id: 'b3', name: 'Excl', status: 'draft', audience_filter: { type: 'all', excludeTagIds: [T] } },
        ],
      },
      T,
    )
    expect(usage.segments.map((s) => s.id)).toEqual(['s1'])
    expect(usage.automations.map((a) => [a.id, a.why])).toEqual([['a1', 'trigger'], ['a3', 'condition']])
    expect(usage.flows.map((f) => f.id)).toEqual(['f1'])
    expect(usage.broadcasts.map((b) => b.id)).toEqual(['b1', 'b3'])
  })
  it('returns empty lists when nothing uses the tag', () => {
    expect(collectTagUsage(base, T)).toEqual({ segments: [], automations: [], flows: [], broadcasts: [] })
  })
})
