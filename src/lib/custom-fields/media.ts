import type { MediaAccept, MediaValue } from './types'

// ============================================================
// Media custom fields: one uploaded file per field. The file lives in the
// public `chat-media` bucket under `account-<id>/custom-fields/`; the field
// stores a small JSON object describing it (see MediaValue).
// ============================================================

export type MediaKind = 'image' | 'video' | 'audio' | 'document'

/** Bucket + folder a media field uploads into. */
export const MEDIA_FIELD_BUCKET = 'chat-media'
export const MEDIA_FIELD_SUBFOLDER = 'custom-fields'

/**
 * Per-kind size caps. Mirrors MEDIA_MAX_BYTES_BY_KIND in
 * `@/lib/storage/upload-media` (kept separate so this module stays free of
 * the browser Supabase client and can run on the server).
 */
export const MEDIA_FIELD_MAX_BYTES: Record<MediaKind, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 16 * 1024 * 1024,
}

export function kindFromMime(mime: string): MediaKind {
  const m = mime.toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  return 'document'
}

export function acceptsMime(accept: MediaAccept | undefined, mime: string): boolean {
  if (!accept || accept === 'any') return true
  return kindFromMime(mime) === accept
}

/** `accept` attribute for the file picker. */
export function acceptAttribute(accept: MediaAccept | undefined): string | undefined {
  switch (accept) {
    case 'image':
      return 'image/png,image/jpeg,image/webp,image/gif'
    case 'video':
      return 'video/mp4,video/3gpp,video/quicktime'
    case 'audio':
      return 'audio/ogg,audio/mpeg,audio/aac,audio/mp4,audio/amr,audio/opus'
    case 'document':
      return '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt'
    default:
      return undefined
  }
}

export type MediaParse = { ok: true; value: MediaValue } | { ok: false; error: string }

/** Parse + validate the shape of a media value (object or JSON text). */
export function parseMediaValue(raw: unknown): MediaParse {
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return { ok: false, error: 'not a file' }
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'not a file' }
  const o = obj as Record<string, unknown>
  const { url, path, name, mime, size } = o
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || url.length > 2000) {
    return { ok: false, error: 'invalid file link' }
  }
  if (typeof path !== 'string' || !path.startsWith('account-') || path.includes('..') || path.length > 500) {
    return { ok: false, error: 'invalid file path' }
  }
  if (typeof name !== 'string' || !name.trim() || name.length > 200) {
    return { ok: false, error: 'invalid file name' }
  }
  if (typeof mime !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(mime)) {
    return { ok: false, error: 'invalid file type' }
  }
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return { ok: false, error: 'invalid file size' }
  }
  return { ok: true, value: { url, path, name: name.trim(), mime: mime.toLowerCase(), size: Math.floor(size) } }
}

/**
 * True when the file is stored in `accountId`'s own folder and the URL
 * really points at that object, so a value can't smuggle in another
 * account's file or an arbitrary link.
 */
export function mediaBelongsToAccount(value: MediaValue, accountId: string): boolean {
  if (!value.path.startsWith(`account-${accountId}/`)) return false
  try {
    const pathname = decodeURIComponent(new URL(value.url).pathname)
    return pathname.endsWith(`/${value.path}`)
  } catch {
    return false
  }
}
