import type { ServerFrame } from './protocol'

// ============================================================
// Push a frame to a conversation's ChatRoom Durable Object from a Next route
// handler or a background job. Realtime is best-effort: if the binding is not
// there (next dev, unit tests) or the push fails, nothing throws, the message
// is already stored and the widget's polling catches up.
// ============================================================

interface RoomNamespace {
  idFromName(name: string): unknown
  get(id: unknown): { fetch(url: string, init?: RequestInit): Promise<Response> }
}

async function roomNamespace(): Promise<RoomNamespace | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const env = getCloudflareContext().env as unknown as { CHAT_ROOM?: RoomNamespace }
    return env.CHAT_ROOM ?? null
  } catch {
    return null
  }
}

/** Returns how many sockets received it (0 when there is no realtime or nobody is connected). */
export async function pushToRoom(
  conversationId: string,
  frame: ServerFrame,
  to: 'visitor' | 'agent' | 'all' = 'all',
): Promise<number> {
  try {
    const ns = await roomNamespace()
    if (!ns) return 0
    const stub = ns.get(ns.idFromName(conversationId.toLowerCase()))
    const res = await stub.fetch('https://chat-room.internal/push', {
      method: 'POST',
      body: JSON.stringify({ frame, to }),
    })
    if (!res.ok) return 0
    const body = (await res.json()) as { delivered?: number }
    return body.delivered ?? 0
  } catch (err) {
    console.error('[chat] push failed:', err instanceof Error ? err.message : err)
    return 0
  }
}
