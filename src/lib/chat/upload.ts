// ============================================================
// Visitor image uploads. An anonymous visitor can upload, so nothing the
// browser says (file name, Content-Type) is trusted: the type comes from the
// file's own first bytes, the extension is derived from that, and SVG/HTML are
// never accepted (they can carry script and the bucket is public).
// ============================================================

export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024

export type ChatImageType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

const EXT: Record<ChatImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** Detect an allowed image type from its leading bytes, or null. Pure. */
export function sniffImageType(bytes: Uint8Array): ChatImageType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)).startsWith('GIF8') &&
      (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'image/gif'
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

export type ImageCheck =
  | { ok: true; type: ChatImageType; ext: string }
  | { ok: false; reason: 'empty' | 'too_large' | 'unsupported_type' }

export function checkChatImage(bytes: Uint8Array): ImageCheck {
  if (bytes.length === 0) return { ok: false, reason: 'empty' }
  if (bytes.length > CHAT_IMAGE_MAX_BYTES) return { ok: false, reason: 'too_large' }
  const type = sniffImageType(bytes)
  if (!type) return { ok: false, reason: 'unsupported_type' }
  return { ok: true, type, ext: EXT[type] }
}

/** Unguessable object path inside the chat-media bucket, scoped to the account folder. */
export function chatImagePath(accountId: string, conversationId: string, ext: string, random: string): string {
  return `account-${accountId}/chat/${conversationId}/${random}.${ext}`
}

/** Caps so one visitor cannot fill the bucket (30 images of at most 5 MB each). */
export const CHAT_UPLOAD_LIMITS = { perConversation: 30 } as const
