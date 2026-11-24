// ============================================================
// WebSocket entry for live chat: GET /ws/chat/<conversationId>?t=<token>
// Verifies the signed token (visitor or agent) and hands the upgrade to that
// conversation's ChatRoom Durable Object. Anything else is left to Next.
// ============================================================

import { pickChatSecret } from './secret'
import { verifyChatToken } from './token'

interface DurableObjectStubLike {
  fetch(request: Request): Promise<Response>
}
interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown
  get(id: unknown): DurableObjectStubLike
}

export interface ChatSocketEnv {
  CHAT_ROOM?: DurableObjectNamespaceLike
  /** The token secret (see ./secret.ts): CHAT_TOKEN_SECRET, else SUPABASE_SERVICE_ROLE_KEY. */
  CHAT_TOKEN_SECRET?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}

const PATH = /^\/ws\/chat\/([0-9a-fA-F-]{36})$/

export function isChatSocketRequest(request: Request): boolean {
  const url = new URL(request.url)
  return PATH.test(url.pathname) && request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
}

export async function routeChatSocket(request: Request, env: ChatSocketEnv): Promise<Response> {
  const url = new URL(request.url)
  const match = PATH.exec(url.pathname)
  if (!match || request.method !== 'GET') return new Response('not found', { status: 404 })
  const secret = pickChatSecret(env as unknown as Record<string, unknown>)
  if (!env.CHAT_ROOM || !secret) return new Response('chat unavailable', { status: 503 })

  const conversationId = match[1].toLowerCase()
  const payload = await verifyChatToken(url.searchParams.get('t'), secret)
  if (!payload || payload.cid.toLowerCase() !== conversationId) return new Response('unauthorized', { status: 401 })

  const headers = new Headers({
    Upgrade: 'websocket',
    'x-chat-role': payload.role,
    'x-chat-sub': payload.sub,
  })
  const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(conversationId))
  return stub.fetch(new Request('https://chat-room.internal/ws', { method: 'GET', headers }))
}
