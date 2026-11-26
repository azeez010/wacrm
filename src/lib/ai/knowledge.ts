import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiConfig, KnowledgeHit } from './types'
import { chunkText } from './chunk'
import { embedTexts, toVectorLiteral } from './embeddings'

// ============================================================
// Knowledge base: ingest (chunk + optionally embed) and hybrid
// retrieve (semantic when an embeddings key is present, topped up with
// lexical full-text search).
// ============================================================

export interface IngestResult {
  keywordOnly: boolean
  embedError: unknown
  chunkCount: number
}

const CHUNK_DELETE_BATCH = 100

interface MatchRow {
  id: string
  content: string
  source_id?: string | null
  document_id?: string | null
  doc_title?: string | null
  score?: number | null
}

/**
 * (Re)build the chunks for one document. Re-chunks the content and -
 * when the account has an embeddings key - embeds each chunk. Runs under
 * whatever client the caller passes (service-role for ingest routes).
 */
export async function ingestDocument(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  documentId: string,
  content: string,
  opts: { chunks?: string[] } = {},
): Promise<IngestResult> {
  // Callers may pre-split (e.g. one chunk per Q&A pair); default is the
  // paragraph-aware chunker.
  const chunks = opts.chunks ?? chunkText(content)

  // Embed if a key is set, but DON'T let an embedding failure stop the
  // chunks from being stored: a failed embed must still leave the
  // document searchable lexically.
  let embeddings: number[][] | null = null
  let embedError: unknown = null
  if (config.embeddingsApiKey && chunks.length > 0) {
    try {
      embeddings = await embedTexts(config.embeddingsApiKey, chunks)
    } catch (err) {
      embedError = err
    }
  }

  const { data: previousChunks, error: listErr } = await db
    .from('ai_knowledge_chunks')
    .select('id')
    .eq('document_id', documentId)
  if (listErr) throw listErr

  if (chunks.length > 0) {
    const rows = chunks.map((content, i) => ({
      document_id: documentId,
      account_id: accountId,
      chunk_index: i,
      content,
      embedding: embeddings ? toVectorLiteral(embeddings[i]) : null,
    }))
    const { error: insErr } = await db.from('ai_knowledge_chunks').insert(rows)
    if (insErr) throw insErr
  }

  const previousIds = (previousChunks ?? []).map((row: { id: string }) => row.id)
  for (let i = 0; i < previousIds.length; i += CHUNK_DELETE_BATCH) {
    const { error: delErr } = await db
      .from('ai_knowledge_chunks')
      .delete()
      .in('id', previousIds.slice(i, i + CHUNK_DELETE_BATCH))
    if (delErr) throw delErr
  }

  return { keywordOnly: embedError !== null, embedError, chunkCount: chunks.length }
}

export interface RetrieveOptions {
  /** Max excerpts to return (default 5). */
  k?: number
  /** Library sources to search. null/undefined = the whole library;
   *  [] = nothing (an agent with no linked knowledge). */
  sourceIds?: string[] | null
}

/**
 * Retrieve up to `k` knowledge excerpts relevant to `queryText`, with the
 * source, document and title each came from.
 *
 * Semantic-primary when an embeddings key is configured (embed the
 * query → cosine-nearest chunks), then topped up with lexical full-text
 * matches to fill `k`. Lexical-only when there's no key. Best-effort:
 * any failure (no KB, embedding error, RPC error) degrades to fewer or
 * zero results and never throws into the draft / auto-reply path.
 */
export async function retrieveKnowledge(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  queryText: string,
  opts: RetrieveOptions = {},
): Promise<KnowledgeHit[]> {
  const k = opts.k ?? 5
  const sourceIds = opts.sourceIds ?? null
  const query = queryText.trim()
  if (!query || k <= 0) return []
  if (sourceIds && sourceIds.length === 0) return []

  // Skip everything when there is nothing to search - otherwise every
  // draft / auto-reply would pay for a query embedding + two RPCs just to
  // get []. One cheap indexed COUNT (head, no rows) instead of a paid
  // embeddings call on the hot path.
  try {
    let countQuery = db
      .from('ai_knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if (sourceIds) countQuery = countQuery.in('source_id', sourceIds)
    const { count, error } = await countQuery
    if (error || !count) return []
  } catch {
    return []
  }

  const picked = new Map<string, KnowledgeHit>() // chunk id → hit, preserves order

  // Semantic path.
  if (config.embeddingsApiKey) {
    try {
      const [queryEmbedding] = await embedTexts(config.embeddingsApiKey, [query])
      if (queryEmbedding) {
        const { data, error } = await db.rpc('match_ai_knowledge_semantic_v2', {
          p_account_id: accountId,
          p_query_embedding: toVectorLiteral(queryEmbedding),
          p_match_count: k,
          p_source_ids: sourceIds,
        })
        if (!error && Array.isArray(data)) {
          for (const row of data as MatchRow[]) picked.set(row.id, toHit(row, 'semantic'))
        }
      }
    } catch (err) {
      console.error('[ai knowledge] semantic retrieval failed, falling back to FTS:', err)
    }
  }

  // Lexical top-up (also the sole path when there's no embeddings key).
  if (picked.size < k) {
    try {
      const { data, error } = await db.rpc('match_ai_knowledge_fts_v2', {
        p_account_id: accountId,
        p_query: query,
        p_match_count: k,
        p_source_ids: sourceIds,
      })
      if (!error && Array.isArray(data)) {
        for (const row of data as MatchRow[]) {
          if (picked.size >= k) break
          if (!picked.has(row.id)) picked.set(row.id, toHit(row, 'keyword'))
        }
      }
    } catch (err) {
      console.error('[ai knowledge] lexical retrieval failed:', err)
    }
  }

  return Array.from(picked.values()).slice(0, k)
}

function toHit(row: MatchRow, matchedBy: KnowledgeHit['matchedBy']): KnowledgeHit {
  return {
    chunkId: row.id,
    sourceId: row.source_id ?? null,
    documentId: row.document_id ?? null,
    title: row.doc_title ?? null,
    content: row.content,
    score: typeof row.score === 'number' ? row.score : 0,
    matchedBy,
  }
}
