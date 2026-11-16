/**
 * In-process dispatch to the public API (/api/v1) route handlers.
 *
 * The hosted MCP endpoint is a thin layer over the public API: each
 * tool builds a Request carrying the caller's own `Authorization`
 * header and invokes the same route handler an HTTP client would hit.
 * So key auth, scope checks, per-key rate limits, plan gates and the
 * `{data}` / `{error}` envelope are all enforced exactly once, by the
 * existing code — and there's no Worker-to-self network hop.
 */
import { GET as meGet } from '@/app/api/v1/me/route'
import { GET as contactsGet, POST as contactsPost } from '@/app/api/v1/contacts/route'
import { GET as contactGet, PATCH as contactPatch } from '@/app/api/v1/contacts/[id]/route'
import { GET as conversationsGet } from '@/app/api/v1/conversations/route'
import { GET as conversationGet } from '@/app/api/v1/conversations/[id]/route'
import { GET as messagesGet } from '@/app/api/v1/conversations/[id]/messages/route'
import { POST as messagesPost } from '@/app/api/v1/messages/route'
import { POST as broadcastsPost } from '@/app/api/v1/broadcasts/route'
import { GET as broadcastGet } from '@/app/api/v1/broadcasts/[id]/route'

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

export class ApiCallError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiCallError'
  }
}

export type ApiResult<T = unknown> = { data: T; next_cursor?: string | null }

async function call(
  authorization: string,
  handler: Handler,
  method: string,
  path: string,
  opts: { query?: Record<string, string | number | undefined>; body?: unknown; id?: string } = {},
): Promise<ApiResult> {
  const url = new URL(`https://mcp.internal/api/v1${path}`)
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  }
  const headers: Record<string, string> = { Authorization: authorization, Accept: 'application/json' }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await handler(
    new Request(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
    { params: Promise.resolve({ id: opts.id ?? '' }) },
  )

  const text = await res.text()
  let payload: { data?: unknown; meta?: { next_cursor?: string | null }; error?: { code?: string; message?: string } } = {}
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    if (!res.ok) throw new ApiCallError(res.status, 'internal', text.slice(0, 300))
  }
  if (!res.ok) {
    let message = payload.error?.message ?? `Request failed with status ${res.status}`
    const retry = res.headers.get('Retry-After')
    if (res.status === 429 && retry) message += ` (retry after ${retry}s)`
    throw new ApiCallError(res.status, payload.error?.code ?? 'internal', message)
  }
  return { data: payload.data, next_cursor: payload.meta?.next_cursor ?? null }
}

const enc = encodeURIComponent

export function createApiClient(authorization: string) {
  return {
    me: () => call(authorization, meGet as Handler, 'GET', '/me'),
    listContacts: (q: Record<string, string | number | undefined>) =>
      call(authorization, contactsGet as Handler, 'GET', '/contacts', { query: q }),
    getContact: (id: string) => call(authorization, contactGet as Handler, 'GET', `/contacts/${enc(id)}`, { id }),
    createContact: (body: unknown) => call(authorization, contactsPost as Handler, 'POST', '/contacts', { body }),
    updateContact: (id: string, body: unknown) =>
      call(authorization, contactPatch as Handler, 'PATCH', `/contacts/${enc(id)}`, { id, body }),
    listConversations: (q: Record<string, string | number | undefined>) =>
      call(authorization, conversationsGet as Handler, 'GET', '/conversations', { query: q }),
    getConversation: (id: string) =>
      call(authorization, conversationGet as Handler, 'GET', `/conversations/${enc(id)}`, { id }),
    listMessages: (id: string, q: Record<string, string | number | undefined>) =>
      call(authorization, messagesGet as Handler, 'GET', `/conversations/${enc(id)}/messages`, { id, query: q }),
    sendMessage: (body: unknown) => call(authorization, messagesPost as Handler, 'POST', '/messages', { body }),
    sendBroadcast: (body: unknown) => call(authorization, broadcastsPost as Handler, 'POST', '/broadcasts', { body }),
    getBroadcast: (id: string) =>
      call(authorization, broadcastGet as Handler, 'GET', `/broadcasts/${enc(id)}`, { id }),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
