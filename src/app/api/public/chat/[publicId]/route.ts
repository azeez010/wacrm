import { chatJson, chatPreflight, loadChatForm } from '@/lib/chat/http'
import { buildChatStatus } from '@/lib/chat/status'

export function OPTIONS() {
  return chatPreflight()
}

/** Is the chat reachable right now, and what should the pre-chat ask for? */
export async function GET(_request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const loaded = await loadChatForm(publicId)
  if (!loaded.ok) return loaded.res
  const { db, form, settings } = loaded.value
  return chatJson({ ok: true, ...(await buildChatStatus(db, form, settings)) })
}
