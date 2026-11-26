// ============================================================
// Parse + validate an "add knowledge source" request. Pure: the route
// does the DB work. Returns what to store for the source and its first
// document (websites get their documents from discovery instead).
// ============================================================

import { normalizeHttpUrl } from './fetch'
import { parsePathPrefixes } from './crawl-rules'
import { parseQaPairs, qaToContent } from './qa'
import {
  KNOWLEDGE_FILE_TYPES,
  KNOWLEDGE_LIMITS,
  SOURCE_TYPES,
  SYNC_INTERVALS,
  capText,
  type SourceType,
  type SyncInterval,
} from './limits'

export type SourceInputError =
  | 'type_invalid'
  | 'name_required'
  | 'content_required'
  | 'content_too_long'
  | 'pairs_required'
  | 'url_invalid'
  | 'file_invalid'
  | 'file_empty'

export interface ParsedSource {
  type: SourceType
  name: string
  config: Record<string, unknown>
  syncInterval: SyncInterval
  /** The first document, or null for a website (found by discovery). */
  document: { title: string; content: string; url: string | null } | null
}

const NAME_MAX = 200

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** "acme.com/help/returns" style label for a URL. */
export function urlLabel(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')
    return `${u.hostname.replace(/^www\./, '')}${path}`.slice(0, NAME_MAX)
  } catch {
    return url.slice(0, NAME_MAX)
  }
}

export function parseSourceInput(
  body: unknown,
  { accountId }: { accountId: string },
): { data: ParsedSource } | { error: SourceInputError } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const type = b.type as SourceType
  if (!SOURCE_TYPES.includes(type)) return { error: 'type_invalid' }
  const requestedName = str(b.name).slice(0, NAME_MAX)
  const sync = SYNC_INTERVALS.includes(b.sync_interval as SyncInterval) ? (b.sync_interval as SyncInterval) : 'none'

  switch (type) {
    case 'text': {
      if (!requestedName) return { error: 'name_required' }
      const content = str(b.content)
      if (!content) return { error: 'content_required' }
      if (content.length > KNOWLEDGE_LIMITS.maxDocChars) return { error: 'content_too_long' }
      return {
        data: { type, name: requestedName, config: {}, syncInterval: 'none', document: { title: requestedName, content, url: null } },
      }
    }
    case 'qa': {
      if (!requestedName) return { error: 'name_required' }
      const pairs = parseQaPairs(b.pairs)
      if (pairs.length === 0) return { error: 'pairs_required' }
      const content = qaToContent(pairs)
      if (content.length > KNOWLEDGE_LIMITS.maxDocChars) return { error: 'content_too_long' }
      return {
        data: { type, name: requestedName, config: {}, syncInterval: 'none', document: { title: requestedName, content, url: null } },
      }
    }
    case 'file': {
      const f = (b.file && typeof b.file === 'object' ? b.file : {}) as Record<string, unknown>
      const fileName = str(f.name).slice(0, NAME_MAX)
      const mime = str(f.mime)
      const size = Number(f.size)
      const storagePath = str(f.storage_path)
      // The browser uploads to the account's own folder; anything else is refused.
      if (
        !fileName ||
        !(mime in KNOWLEDGE_FILE_TYPES) ||
        !Number.isFinite(size) ||
        size <= 0 ||
        size > KNOWLEDGE_LIMITS.maxFileBytes ||
        !storagePath.startsWith(`account-${accountId}/`) ||
        storagePath.includes('..')
      ) {
        return { error: 'file_invalid' }
      }
      const text = capText(str(f.text))
      if (!text) return { error: 'file_empty' }
      const name = requestedName || fileName
      return {
        data: {
          type,
          name,
          config: { fileName, mime, size, storagePath },
          syncInterval: 'none',
          document: { title: name, content: text, url: null },
        },
      }
    }
    case 'url': {
      const url = normalizeHttpUrl(str(b.url))
      if (!url) return { error: 'url_invalid' }
      const name = requestedName || urlLabel(url)
      return {
        data: { type, name, config: { url }, syncInterval: sync, document: { title: url, content: '', url } },
      }
    }
    case 'website': {
      const startUrl = normalizeHttpUrl(str(b.start_url ?? b.url))
      if (!startUrl) return { error: 'url_invalid' }
      const maxPages = Number(b.max_pages)
      const config = {
        startUrl,
        maxPages: Number.isFinite(maxPages)
          ? Math.min(KNOWLEDGE_LIMITS.maxWebsitePages, Math.max(1, Math.floor(maxPages)))
          : KNOWLEDGE_LIMITS.defaultWebsitePages,
        include: parsePathPrefixes(b.include),
        exclude: parsePathPrefixes(b.exclude),
      }
      return {
        data: {
          type,
          name: requestedName || new URL(startUrl).hostname.replace(/^www\./, ''),
          config,
          syncInterval: sync,
          document: null,
        },
      }
    }
  }
}
