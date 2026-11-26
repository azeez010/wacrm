// ============================================================
// Knowledge library: browser side. Types for the library API, and file
// uploads: the text is extracted here in the browser (PDF via unpdf, DOCX
// via mammoth, plain text read directly) so large files never cost the
// Worker CPU, and the original goes to the private knowledge-files bucket.
// ============================================================

import { createClient } from '@/lib/supabase/client'
import { KNOWLEDGE_FILE_TYPES, KNOWLEDGE_LIMITS, capText, type SourceType, type SyncInterval } from './ingest/limits'

export type SourceStatus = 'queued' | 'processing' | 'ready' | 'partial' | 'failed'

export interface SourceDto {
  id: string
  name: string
  type: SourceType
  status: SourceStatus
  error: string | null
  config: Record<string, unknown>
  sync_interval: SyncInterval
  last_synced_at: string | null
  next_sync_at: string | null
  doc_count: number
  chunk_count: number
  created_by: string | null
  created_at: string
  updated_at: string
  /** Agents linked to this source. */
  agents?: { id: string; name: string }[]
  /** Agents that use the whole library. */
  all_agents?: { id: string; name: string }[]
}

export interface SourceDocumentDto {
  id: string
  title: string
  url: string | null
  status: 'queued' | 'processing' | 'ready' | 'failed'
  error: string | null
  chunk_count: number
  updated_at: string
}

export interface SourceDetailDto extends SourceDto {
  content?: string
  pairs?: { question: string; answer: string }[]
  agent_ids: string[]
  can_edit: boolean
}

export const KNOWLEDGE_BUCKET = 'knowledge-files'

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
}

/** The file's knowledge mime type, or null when unsupported. Browsers
 *  often report markdown/CSV inconsistently, so the extension decides. */
export function knowledgeFileMime(file: Pick<File, 'name' | 'type'>): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const byExt = EXT_MIME[ext]
  if (byExt) return byExt
  return file.type in KNOWLEDGE_FILE_TYPES ? file.type : null
}

export const KNOWLEDGE_FILE_ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.csv'

export class FileRejectedError extends Error {
  constructor(public reason: 'type' | 'size' | 'empty' | 'unreadable') {
    super(reason)
  }
}

/** Extract readable text from a PDF, DOCX or text file. */
export async function extractFileText(file: File): Promise<string> {
  const mime = knowledgeFileMime(file)
  if (!mime) throw new FileRejectedError('type')
  if (file.size > KNOWLEDGE_LIMITS.maxFileBytes) throw new FileRejectedError('size')

  let text: string
  try {
    if (mime === 'application/pdf') {
      const { extractText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()))
      const result = await extractText(pdf, { mergePages: false })
      // Page breaks become paragraph breaks for the chunker.
      text = result.text.map((page) => page.trim()).filter(Boolean).join('\n\n')
    } else if (mime === KNOWLEDGE_FILE_TYPES_DOCX) {
      const mammoth = (await import('mammoth')).default
      text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value
    } else {
      text = await file.text()
    }
  } catch {
    throw new FileRejectedError('unreadable')
  }
  const clean = capText(text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim())
  if (!clean) throw new FileRejectedError('empty')
  return clean
}

const KNOWLEDGE_FILE_TYPES_DOCX = EXT_MIME.docx

/** Upload the original to the account's folder; returns its storage path. */
export async function uploadKnowledgeFile(accountId: string, file: File): Promise<{ path: string; mime: string }> {
  const mime = knowledgeFileMime(file)
  if (!mime) throw new FileRejectedError('type')
  const ext = KNOWLEDGE_FILE_TYPES[mime]
  const path = `account-${accountId}/${crypto.randomUUID()}.${ext}`
  const { error } = await createClient().storage.from(KNOWLEDGE_BUCKET).upload(path, file, {
    contentType: mime,
    upsert: false,
  })
  if (error) throw error
  return { path, mime }
}

/** Remove an uploaded file when creating its source failed. Best-effort. */
export async function removeKnowledgeFile(path: string): Promise<void> {
  try {
    await createClient().storage.from(KNOWLEDGE_BUCKET).remove([path])
  } catch {
    // the orphan only costs storage
  }
}
