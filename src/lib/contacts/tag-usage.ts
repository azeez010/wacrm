import { isGroup, type FilterGroup } from '@/lib/segments/types'

// ============================================================
// "What depends on this tag?" Pure helpers used by the remove-tag
// confirmation. The route fetches the rows; this module decides which of
// them reference the tag, so it is easy to test.
// ============================================================

export interface NamedRef {
  id: string
  name: string
}

export interface TagUsage {
  segments: NamedRef[]
  automations: (NamedRef & { why: 'trigger' | 'condition' | 'action' })[]
  flows: NamedRef[]
  broadcasts: NamedRef[]
  /** How many contacts currently carry the tag (filled by the route, not by collectTagUsage). */
  contactCount?: number
}

export const EMPTY_USAGE: TagUsage = { segments: [], automations: [], flows: [], broadcasts: [] }

interface SegmentRow {
  id: string
  name: string
  filter: FilterGroup | null
}
interface AutomationRow {
  id: string
  name: string
  trigger_type: string
  trigger_config: Record<string, unknown> | null
}
interface AutomationStepRow {
  automation_id: string
  step_type: string
  step_config: Record<string, unknown> | null
  automation: { id: string; name: string; is_active: boolean } | null
}
interface FlowNodeRow {
  node_type: string
  config: Record<string, unknown> | null
  flow: { id: string; name: string; status: string } | null
}
interface BroadcastRow {
  id: string
  name: string
  status: string
  audience_filter: Record<string, unknown> | null
}

/** True when a (possibly nested) segment filter has a tags rule that lists the tag. */
export function filterUsesTag(filter: FilterGroup | null | undefined, tagId: string): boolean {
  if (!filter || !Array.isArray(filter.rules)) return false
  return filter.rules.some((r) =>
    isGroup(r)
      ? filterUsesTag(r, tagId)
      : r.field === 'tags' && Array.isArray(r.value) && (r.value as unknown[]).includes(tagId),
  )
}

function uniqueById<T extends NamedRef>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
}

/** Which active automations, flows, segments and open broadcasts reference `tagId`. */
export function collectTagUsage(
  input: {
    segments: SegmentRow[]
    automations: AutomationRow[]
    steps: AutomationStepRow[]
    nodes: FlowNodeRow[]
    broadcasts: BroadcastRow[]
  },
  tagId: string,
): TagUsage {
  const segments = input.segments.filter((s) => filterUsesTag(s.filter, tagId)).map((s) => ({ id: s.id, name: s.name }))

  const automations: TagUsage['automations'] = []
  for (const a of input.automations) {
    if (a.trigger_type === 'tag_added' && a.trigger_config?.tag_id === tagId) {
      automations.push({ id: a.id, name: a.name, why: 'trigger' })
    }
  }
  for (const s of input.steps) {
    if (!s.automation?.is_active) continue
    const cfg = s.step_config ?? {}
    if (s.step_type === 'condition' && cfg.subject === 'tag_presence' && cfg.operand === tagId) {
      automations.push({ id: s.automation.id, name: s.automation.name, why: 'condition' })
    } else if ((s.step_type === 'add_tag' || s.step_type === 'remove_tag') && cfg.tag_id === tagId) {
      automations.push({ id: s.automation.id, name: s.automation.name, why: 'action' })
    }
  }

  const flows: NamedRef[] = []
  for (const n of input.nodes) {
    if (n.flow?.status !== 'active') continue
    const cfg = n.config ?? {}
    if (
      (n.node_type === 'set_tag' && cfg.tag_id === tagId) ||
      (n.node_type === 'condition' && cfg.subject === 'tag' && cfg.subject_key === tagId)
    ) {
      flows.push({ id: n.flow.id, name: n.flow.name })
    }
  }

  const broadcasts = input.broadcasts
    .filter((b) => ['draft', 'scheduled', 'sending'].includes(b.status))
    .filter((b) => {
      const f = b.audience_filter ?? {}
      const include = Array.isArray(f.tagIds) ? (f.tagIds as unknown[]) : []
      const exclude = Array.isArray(f.excludeTagIds) ? (f.excludeTagIds as unknown[]) : []
      return include.includes(tagId) || exclude.includes(tagId)
    })
    .map((b) => ({ id: b.id, name: b.name }))

  return {
    segments: uniqueById(segments),
    // one automation may match for several reasons; keep the first
    automations: uniqueById(automations),
    flows: uniqueById(flows),
    broadcasts: uniqueById(broadcasts),
  }
}

// ---------------- client cache (used by the remove dialog) ----------------

const TTL_MS = 60_000
const cache = new Map<string, { at: number; usage: TagUsage }>()
const inflight = new Map<string, Promise<TagUsage>>()

/** Usage for a tag, cached for a minute. Safe to call repeatedly (hover pre-fetch). */
export function fetchTagUsage(tagId: string, force = false): Promise<TagUsage> {
  const hit = cache.get(tagId)
  if (!force && hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.usage)
  const running = inflight.get(tagId)
  if (running) return running
  const p = fetch(`/api/tags/${tagId}/usage`)
    .then(async (res) => {
      if (!res.ok) throw new Error('usage failed')
      const data = (await res.json()) as { usage: TagUsage }
      cache.set(tagId, { at: Date.now(), usage: data.usage })
      return data.usage
    })
    .finally(() => inflight.delete(tagId))
  inflight.set(tagId, p)
  return p
}

/** Cached usage if still fresh (lets the dialog open with the answer ready). */
export function peekTagUsage(tagId: string): TagUsage | null {
  const hit = cache.get(tagId)
  return hit && Date.now() - hit.at < TTL_MS ? hit.usage : null
}

export function clearTagUsageCache() {
  cache.clear()
}
