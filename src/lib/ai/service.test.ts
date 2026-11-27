import { describe, expect, it, vi } from 'vitest'

vi.mock('./ingest/pipeline', () => ({ SOURCE_COLUMNS: 'id, type', queueSourceSync: vi.fn(), runKnowledgeQueue: vi.fn(async () => undefined) }))
vi.mock('./config', () => ({ loadEmbeddingsKey: async () => ({ key: null, corrupt: false }) }))
vi.mock('./knowledge', () => ({ minSimilarity: () => 0.3, retrieveKnowledge: async () => [] }))

import { createAgent, createSource, deleteAgent, searchKnowledge, setAgentKnowledge } from './service'

type Rows = Record<string, Record<string, unknown>[]>

/** Tiny fake: eq/in filters over in-memory rows; inserts are recorded. */
function fakeDb(rows: Rows) {
  const inserts: { table: string; row: unknown }[] = []
  const from = (table: string) => {
    let list = [...(rows[table] ?? [])]
    let countMode = false
    const q: Record<string, unknown> = {}
    q.select = (_c?: string, opts?: { count?: string; head?: boolean }) => {
      countMode = Boolean(opts?.head)
      return q
    }
    q.eq = (c: string, v: unknown) => {
      list = list.filter((r) => r[c] === v)
      return q
    }
    q.in = (c: string, vs: unknown[]) => {
      list = list.filter((r) => vs.includes(r[c]))
      return q
    }
    q.order = () => q
    q.maybeSingle = async () => ({ data: list[0] ?? null, error: null })
    q.single = async () => ({ data: list[0] ?? { id: 'new' }, error: null })
    q.insert = (row: unknown) => {
      inserts.push({ table, row })
      const r = { ...(row as Record<string, unknown>), id: 'new' }
      list = [r]
      return q
    }
    q.delete = () => q
    q.update = () => q
    q.then = (r: (v: unknown) => unknown) => r(countMode ? { count: list.length, error: null } : { data: list, error: null })
    return q
  }
  return { db: { from } as never, inserts }
}

describe('AI service', () => {
  it('makes the first agent the default and refuses past 20', async () => {
    const { db, inserts } = fakeDb({ ai_agents: [] })
    const r = await createAgent(db, 'acc', 'u1', { name: 'Support' })
    expect(r.ok).toBe(true)
    expect(inserts[0].row).toMatchObject({ account_id: 'acc', created_by: 'u1', is_default: true, name: 'Support' })

    const many = Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, account_id: 'acc' }))
    expect(await createAgent(fakeDb({ ai_agents: many }).db, 'acc', 'u1', { name: 'X' })).toMatchObject({ ok: false, code: 'agent_limit' })
  })

  it('only hands off to members of this workspace', async () => {
    const { db } = fakeDb({ ai_agents: [], account_members: [{ account_id: 'other', user_id: 'stranger' }] })
    expect(await createAgent(db, 'acc', 'u1', { name: 'S', handoff_agent_id: 'stranger' })).toMatchObject({ ok: false, code: 'handoff_not_member' })
  })

  it('never deletes the default agent, and 404s another workspace agent', async () => {
    const { db } = fakeDb({ ai_agents: [{ id: 'd', account_id: 'acc', is_default: true }, { id: 'x', account_id: 'other', is_default: false }] })
    expect(await deleteAgent(db, 'acc', 'd')).toMatchObject({ ok: false, code: 'default_undeletable' })
    expect(await deleteAgent(db, 'acc', 'x')).toMatchObject({ ok: false, status: 404 })
  })

  it('links only sources from this workspace', async () => {
    const { db } = fakeDb({
      ai_agents: [{ id: 'a', account_id: 'acc' }],
      ai_knowledge_sources: [{ id: 's1', account_id: 'acc' }, { id: 's2', account_id: 'other' }],
      ai_agent_knowledge: [],
    })
    expect(await setAgentKnowledge(db, 'acc', 'a', ['s1', 's2'])).toMatchObject({ ok: false, code: 'unknown_sources' })
    expect(await setAgentKnowledge(db, 'acc', 'a', 'nope')).toMatchObject({ ok: false, code: 'source_ids_required' })
    expect(await setAgentKnowledge(db, 'acc', 'a', ['s1'])).toEqual({ ok: true, data: { source_ids: ['s1'] } })
  })

  it('leaves file uploads to the app and needs a query to search', async () => {
    const { db } = fakeDb({ ai_knowledge_sources: [] })
    expect(await createSource(db, db, 'acc', 'u1', { type: 'file' })).toMatchObject({ ok: false, code: 'file_upload_only' })
    expect(await searchKnowledge(db, 'acc', { query: '  ' })).toMatchObject({ ok: false, code: 'query_required' })
    expect(await searchKnowledge(db, 'acc', { query: 'opening hours' })).toMatchObject({ ok: true, data: { semantic: false, hits: [] } })
  })
})
