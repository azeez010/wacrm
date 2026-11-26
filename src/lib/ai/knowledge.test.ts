import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({ embedTexts: vi.fn() }))
vi.mock('./embeddings', () => ({
  embedTexts: h.embedTexts,
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}))

import { retrieveKnowledge, ingestDocument } from './knowledge'

interface FakeState {
  semantic: { id: string; content: string }[]
  fts: { id: string; content: string }[]
  chunkCount: number
  rpcCalls: string[]
  rpcArgs: Record<string, unknown>[]
  countScopedTo: string[] | null
  inserted: Record<string, unknown>[] | null
  deletedIds: string[] | null
  existingChunkIds: string[]
  events: string[]
  insertError: unknown
}

function makeDb() {
  const state: FakeState = {
    semantic: [],
    fts: [],
    chunkCount: 5, // account has a non-empty KB by default
    rpcCalls: [],
    rpcArgs: [],
    countScopedTo: null,
    inserted: null,
    deletedIds: null,
    existingChunkIds: ['old-1', 'old-2'],
    events: [],
    insertError: null,
  }
  const db = {
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push(name)
      state.rpcArgs.push(args)
      if (name === 'match_ai_knowledge_semantic_v2')
        return Promise.resolve({ data: state.semantic, error: null })
      if (name === 'match_ai_knowledge_fts_v2')
        return Promise.resolve({ data: state.fts, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    from: () => ({
      // retrieveKnowledge's empty-KB count guard.
      select: () => ({
        eq: () => {
          state.events.push('list')
          const result = Promise.resolve({
            count: state.chunkCount,
            data: state.existingChunkIds.map((id) => ({ id })),
            error: null,
          })
          // retrieveKnowledge narrows the count to the agent's sources.
          return Object.assign(result, {
            in: (_col: string, ids: string[]) => {
              state.countScopedTo = ids
              return result
            },
          })
        },
      }),
      delete: () => ({
        in: (_col: string, ids: string[]) => {
          state.events.push('delete')
          state.deletedIds = [...(state.deletedIds ?? []), ...ids]
          return Promise.resolve({ error: null })
        },
      }),
      insert: (rows: Record<string, unknown>[]) => {
        state.events.push('insert')
        if (state.insertError) return Promise.resolve({ error: state.insertError })
        state.inserted = rows
        return Promise.resolve({ error: null })
      },
    }),
  }
  return { db: db as unknown as SupabaseClient, state }
}

beforeEach(() => {
  h.embedTexts.mockReset()
  h.embedTexts.mockImplementation(async (_key: string, inputs: string[]) =>
    inputs.map((_, i) => [i, i]),
  )
})

describe('retrieveKnowledge', () => {
  it('returns [] for an empty query without touching the DB', async () => {
    const { db, state } = makeDb()
    expect(await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, '  ')).toEqual([])
    expect(state.rpcCalls).toEqual([])
  })

  it('short-circuits (no embed, no RPC) when the KB is empty', async () => {
    const { db, state } = makeDb()
    state.chunkCount = 0
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q')
    expect(out).toEqual([])
    expect(h.embedTexts).not.toHaveBeenCalled()
    expect(state.rpcCalls).toEqual([])
  })

  it('uses lexical FTS only when there is no embeddings key', async () => {
    const { db, state } = makeDb()
    state.fts = [{ id: 'f1', content: 'F1' }]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, 'q')
    expect(out.map((h) => h.content)).toEqual(['F1'])
    expect(out[0].matchedBy).toBe('keyword')
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_fts_v2'])
    expect(h.embedTexts).not.toHaveBeenCalled()
  })

  it('uses semantic search when an embeddings key is present', async () => {
    const { db, state } = makeDb()
    state.semantic = [
      { id: 's1', content: 'S1' },
      { id: 's2', content: 'S2' },
      { id: 's3', content: 'S3' },
    ]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q', { k: 3 })
    expect(out.map((h) => h.content)).toEqual(['S1', 'S2', 'S3'])
    expect(h.embedTexts).toHaveBeenCalledTimes(1)
    // Enough semantic hits → no FTS top-up.
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_semantic_v2'])
  })

  it('tops up with FTS and dedupes when semantic is short', async () => {
    const { db, state } = makeDb()
    state.semantic = [
      { id: 's1', content: 'S1' },
      { id: 's2', content: 'S2' },
    ]
    state.fts = [
      { id: 's2', content: 'S2-dup' }, // dedup by id
      { id: 'f1', content: 'F1' },
    ]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q', { k: 3 })
    expect(out.map((h) => h.content)).toEqual(['S1', 'S2', 'F1'])
    expect(out.map((h) => h.matchedBy)).toEqual(['semantic', 'semantic', 'keyword'])
    expect(state.rpcCalls).toEqual([
      'match_ai_knowledge_semantic_v2',
      'match_ai_knowledge_fts_v2',
    ])
  })

  it('returns where each excerpt came from', async () => {
    const { db, state } = makeDb()
    state.fts = [
      { id: 'c1', content: 'Refunds within 30 days', source_id: 'src-1', document_id: 'doc-1', doc_title: 'Returns policy', score: 0.4 },
    ] as unknown as FakeState['fts']
    const [hit] = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, 'refund')
    expect(hit).toEqual({
      chunkId: 'c1',
      sourceId: 'src-1',
      documentId: 'doc-1',
      title: 'Returns policy',
      content: 'Refunds within 30 days',
      score: 0.4,
      matchedBy: 'keyword',
    })
  })

  it('searches the whole library when no sources are given', async () => {
    const { db, state } = makeDb()
    state.fts = [{ id: 'f1', content: 'F1' }]
    await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, 'q')
    expect(state.countScopedTo).toBeNull()
    expect(state.rpcArgs[0].p_source_ids).toBeNull()
  })

  it("limits the search to an agent's linked sources", async () => {
    const { db, state } = makeDb()
    state.semantic = [{ id: 's1', content: 'S1' }]
    state.fts = [{ id: 'f1', content: 'F1' }]
    await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q', {
      sourceIds: ['src-a', 'src-b'],
    })
    expect(state.countScopedTo).toEqual(['src-a', 'src-b'])
    expect(state.rpcArgs.map((a) => a.p_source_ids)).toEqual([
      ['src-a', 'src-b'],
      ['src-a', 'src-b'],
    ])
  })

  it('returns nothing, with no embed or RPC, for an agent with no linked sources', async () => {
    const { db, state } = makeDb()
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q', {
      sourceIds: [],
    })
    expect(out).toEqual([])
    expect(h.embedTexts).not.toHaveBeenCalled()
    expect(state.rpcCalls).toEqual([])
    expect(state.events).toEqual([])
  })
})

describe('ingestDocument', () => {
  it('embeds chunks when a key is present', async () => {
    const { db, state } = makeDb()
    const result = await ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', 'hello world')
    expect(result).toEqual({ keywordOnly: false, embedError: null, chunkCount: 1 })
    expect(h.embedTexts).toHaveBeenCalledTimes(1)
    expect(state.deletedIds).toEqual(['old-1', 'old-2'])
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted![0].embedding).toBe('[0,0]') // literal from mocked embed
    expect(state.inserted![0].account_id).toBe('acct')
  })

  it('stores chunks without embeddings when there is no key', async () => {
    const { db, state } = makeDb()
    await ingestDocument(db, 'acct', { embeddingsApiKey: null }, 'doc-1', 'hello world')
    expect(h.embedTexts).not.toHaveBeenCalled()
    expect(state.inserted![0].embedding).toBeNull()
  })

  it('deletes existing chunks and inserts nothing for empty content', async () => {
    const { db, state } = makeDb()
    await ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', '   ')
    expect(state.deletedIds).toEqual(['old-1', 'old-2'])
    expect(state.inserted).toBeNull()
    expect(h.embedTexts).not.toHaveBeenCalled()
  })

  it('reports keyword-only success when embedding fails', async () => {
    const { db, state } = makeDb()
    const embedError = new Error('rate limited')
    h.embedTexts.mockRejectedValueOnce(embedError)
    const result = await ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', 'hello world')
    expect(result).toEqual({ keywordOnly: true, embedError, chunkCount: 1 })
    // Chunks were inserted (lexical search works) despite the embed failure…
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted![0].embedding).toBeNull()
  })

  it('keeps the existing chunks until the embed has finished', async () => {
    const { db, state } = makeDb()
    h.embedTexts.mockImplementationOnce(async () => {
      expect(state.events).toEqual([])
      throw new Error('timeout')
    })
    await ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', 'hello world')
    expect(state.events).toEqual(['list', 'insert', 'delete'])
  })

  it('keeps the existing chunks when the insert fails', async () => {
    const { db, state } = makeDb()
    state.insertError = new Error('insert failed')
    await expect(
      ingestDocument(db, 'acct', { embeddingsApiKey: null }, 'doc-1', 'hello world'),
    ).rejects.toThrow('insert failed')
    expect(state.deletedIds).toBeNull()
  })

  it('deletes previous chunks in batches', async () => {
    const { db, state } = makeDb()
    state.existingChunkIds = Array.from({ length: 250 }, (_, i) => `old-${i}`)
    await ingestDocument(db, 'acct', { embeddingsApiKey: null }, 'doc-1', 'hello world')
    expect(state.events.filter((e) => e === 'delete')).toHaveLength(3)
    expect(state.deletedIds).toHaveLength(250)
  })
})
