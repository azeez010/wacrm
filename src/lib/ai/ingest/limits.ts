// ============================================================
// Knowledge library limits. Kept in one place so the routes, the pipeline
// and the UI agree.
// ============================================================

export const KNOWLEDGE_LIMITS = {
  /** Characters kept per document (text, file, or one web page). */
  maxDocChars: 300_000,
  /** Library sources per account. */
  maxSourcesPerAccount: 200,
  /** Documents (pages, files, texts) per account. */
  maxDocsPerAccount: 2_000,
  /** Q&A pairs in one Q&A source. */
  maxQaPairs: 500,
  /** Pages a website source may crawl. */
  defaultWebsitePages: 50,
  maxWebsitePages: 200,
  /** Uploaded files (matches the knowledge-files bucket). */
  maxFileBytes: 20 * 1024 * 1024,
  /** One HTTP fetch of a web page or sitemap. */
  fetchTimeoutMs: 10_000,
  maxFetchBytes: 2_000_000,
  maxRedirects: 5,
} as const

export const SOURCE_TYPES = ['text', 'qa', 'file', 'url', 'website'] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

export const SYNC_INTERVALS = ['none', 'daily', 'weekly'] as const
export type SyncInterval = (typeof SYNC_INTERVALS)[number]

export const KNOWLEDGE_FILE_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
}

/** When the next scheduled re-sync is due, or null for 'none'. */
export function nextSyncAt(interval: SyncInterval, from: Date = new Date()): string | null {
  if (interval === 'none') return null
  const days = interval === 'daily' ? 1 : 7
  return new Date(from.getTime() + days * 86_400_000).toISOString()
}

/** Cap text to the per-document limit. */
export function capText(text: string): string {
  return text.length > KNOWLEDGE_LIMITS.maxDocChars ? text.slice(0, KNOWLEDGE_LIMITS.maxDocChars) : text
}
