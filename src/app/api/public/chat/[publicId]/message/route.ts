import { authorizeVisitor, chatJson, chatPreflight } from '@/lib/chat/http'
import { CHAT_IMAGE_MAX_BYTES, CHAT_UPLOAD_LIMITS, checkChatImage, chatImagePath } from '@/lib/chat/upload'
import { recordVisitorMessage } from '@/lib/inbound/web-chat'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

const BUCKET = 'chat-media'
const MAX_JSON = 20_000

export function OPTIONS() {
  return chatPreflight()
}

/** A visitor message: JSON {text, clientId} or multipart {file, text?, clientId?} for an image. */
export async function POST(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const auth = await authorizeVisitor(request, publicId)
  if (!auth.ok) return auth.res
  const { db, token, conversation, form } = auth.value

  if (!checkRateLimit(`chat-msg:${token.cid}`, RATE_LIMITS.chatMessage).success) {
    return chatJson({ ok: false, error: 'rate_limited' }, 429, { 'Retry-After': '30' })
  }

  let text: string | null = null
  let clientId: string | null = null
  let file: File | null = null

  const type = request.headers.get('content-type') ?? ''
  if (type.startsWith('multipart/form-data')) {
    const length = Number(request.headers.get('content-length') ?? 0)
    if (length > CHAT_IMAGE_MAX_BYTES + 100_000) return chatJson({ ok: false, error: 'too_large' }, 413)
    const form = await request.formData().catch(() => null)
    if (!form) return chatJson({ ok: false, error: 'invalid' }, 400)
    const f = form.get('file')
    if (f instanceof File) file = f
    text = typeof form.get('text') === 'string' ? (form.get('text') as string) : null
    clientId = typeof form.get('clientId') === 'string' ? (form.get('clientId') as string) : null
  } else {
    const raw = await request.text().catch(() => '')
    if (raw.length > MAX_JSON) return chatJson({ ok: false, error: 'too_large' }, 413)
    try {
      const j = JSON.parse(raw || '{}') as { text?: unknown; clientId?: unknown }
      text = typeof j.text === 'string' ? j.text : null
      clientId = typeof j.clientId === 'string' ? j.clientId : null
    } catch {
      return chatJson({ ok: false, error: 'bad_json' }, 400)
    }
  }
  if (!file && !text?.trim()) return chatJson({ ok: false, error: 'empty' }, 400)
  if (text && text.length > 4000) return chatJson({ ok: false, error: 'too_large' }, 413)

  let imageUrl: string | null = null
  let imageMime: string | null = null
  let storedPath: string | null = null
  if (file) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const check = checkChatImage(bytes) // the file's own bytes decide, never its name or declared type
    if (!check.ok) return chatJson({ ok: false, error: check.reason }, check.reason === 'too_large' ? 413 : 400)

    const { count } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'customer')
      .eq('content_type', 'image')
    if ((count ?? 0) >= CHAT_UPLOAD_LIMITS.perConversation) return chatJson({ ok: false, error: 'upload_limit' }, 429)

    storedPath = chatImagePath(form.account_id, conversation.id, check.ext, crypto.randomUUID().replace(/-/g, ''))
    const up = await db.storage.from(BUCKET).upload(storedPath, bytes, { contentType: check.type, upsert: false, cacheControl: '31536000' })
    if (up.error) {
      console.error('[chat/message] upload failed:', up.error.message)
      return chatJson({ ok: false, error: 'server_error' }, 500)
    }
    imageUrl = db.storage.from(BUCKET).getPublicUrl(storedPath).data.publicUrl
    imageMime = check.type
  }

  try {
    const result = await recordVisitorMessage(db, {
      accountId: form.account_id,
      contactId: conversation.contact_id,
      conversationId: conversation.id,
      content: { text, imageUrl, imageMime, clientId },
    })
    // A replayed send must not leave a second copy of the image behind.
    if (result.duplicate && storedPath) await db.storage.from(BUCKET).remove([storedPath]).catch(() => undefined)
    return chatJson({ ok: true, message: result.message, duplicate: result.duplicate })
  } catch (err) {
    if (storedPath) await db.storage.from(BUCKET).remove([storedPath]).catch(() => undefined)
    console.error('[chat/message] failed:', err instanceof Error ? err.message : err)
    return chatJson({ ok: false, error: 'server_error' }, 500)
  }
}
