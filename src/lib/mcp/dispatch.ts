/**
 * In-process dispatch to the public API (/api/v1) route handlers.
 *
 * The hosted MCP endpoint is a thin layer over the public API: each
 * tool builds a Request carrying the caller's own `Authorization`
 * header and invokes the same route handler an HTTP client would hit.
 * So key auth, scope checks, per-key rate limits, plan gates and the
 * `{data}` / `{error}` envelope are all enforced exactly once, by the
 * existing code - and there's no Worker-to-self network hop.
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
import { GET as templatesGet, POST as templatesPost } from '@/app/api/v1/templates/route'
import { GET as tagsGet, POST as tagsPost } from '@/app/api/v1/tags/route'
import { GET as teamGet } from '@/app/api/v1/team/route'
import { GET as pipelinesGet, POST as pipelinesPost } from '@/app/api/v1/pipelines/route'
import { PATCH as pipelinePatch, DELETE as pipelineDelete } from '@/app/api/v1/pipelines/[id]/route'
import { GET as dealsGet, POST as dealsPost } from '@/app/api/v1/deals/route'
import { PATCH as dealPatch } from '@/app/api/v1/deals/[id]/route'
import { GET as automationsGet, POST as automationsPost } from '@/app/api/v1/automations/route'
import {
  GET as automationGet,
  PATCH as automationPatch,
  DELETE as automationDelete,
} from '@/app/api/v1/automations/[id]/route'
import { POST as automationValidate } from '@/app/api/v1/automations/validate/route'
import { GET as flowsGet, POST as flowsPost } from '@/app/api/v1/flows/route'
import { GET as flowGet, PUT as flowPut, DELETE as flowDelete } from '@/app/api/v1/flows/[id]/route'
import { POST as flowStatus } from '@/app/api/v1/flows/[id]/status/route'
import { POST as flowValidate } from '@/app/api/v1/flows/validate/route'

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
    listTemplates: (q: Record<string, string | number | undefined>) =>
      call(authorization, templatesGet as Handler, 'GET', '/templates', { query: q }),
    createTemplate: (body: unknown) =>
      call(authorization, templatesPost as Handler, 'POST', '/templates', { body }),
    listTags: () => call(authorization, tagsGet as Handler, 'GET', '/tags'),
    createTag: (body: unknown) => call(authorization, tagsPost as Handler, 'POST', '/tags', { body }),
    listTeam: () => call(authorization, teamGet as Handler, 'GET', '/team'),
    listPipelines: () => call(authorization, pipelinesGet as Handler, 'GET', '/pipelines'),
    createPipeline: (body: unknown) => call(authorization, pipelinesPost as Handler, 'POST', '/pipelines', { body }),
    updatePipeline: (id: string, body: unknown) =>
      call(authorization, pipelinePatch as Handler, 'PATCH', `/pipelines/${enc(id)}`, { id, body }),
    deletePipeline: (id: string) =>
      call(authorization, pipelineDelete as Handler, 'DELETE', `/pipelines/${enc(id)}`, { id }),
    listDeals: (q: Record<string, string | number | undefined>) =>
      call(authorization, dealsGet as Handler, 'GET', '/deals', { query: q }),
    createDeal: (body: unknown) => call(authorization, dealsPost as Handler, 'POST', '/deals', { body }),
    updateDeal: (id: string, body: unknown) =>
      call(authorization, dealPatch as Handler, 'PATCH', `/deals/${enc(id)}`, { id, body }),
    listAutomations: (q: Record<string, string | number | undefined>) =>
      call(authorization, automationsGet as Handler, 'GET', '/automations', { query: q }),
    getAutomation: (id: string) =>
      call(authorization, automationGet as Handler, 'GET', `/automations/${enc(id)}`, { id }),
    createAutomation: (body: unknown) =>
      call(authorization, automationsPost as Handler, 'POST', '/automations', { body }),
    updateAutomation: (id: string, body: unknown) =>
      call(authorization, automationPatch as Handler, 'PATCH', `/automations/${enc(id)}`, { id, body }),
    deleteAutomation: (id: string) =>
      call(authorization, automationDelete as Handler, 'DELETE', `/automations/${enc(id)}`, { id }),
    validateAutomation: (body: unknown) =>
      call(authorization, automationValidate as Handler, 'POST', '/automations/validate', { body }),
    listFlows: (q: Record<string, string | number | undefined>) =>
      call(authorization, flowsGet as Handler, 'GET', '/flows', { query: q }),
    getFlow: (id: string) => call(authorization, flowGet as Handler, 'GET', `/flows/${enc(id)}`, { id }),
    createFlow: (body: unknown) => call(authorization, flowsPost as Handler, 'POST', '/flows', { body }),
    updateFlow: (id: string, body: unknown) =>
      call(authorization, flowPut as Handler, 'PUT', `/flows/${enc(id)}`, { id, body }),
    setFlowStatus: (id: string, status: string) =>
      call(authorization, flowStatus as Handler, 'POST', `/flows/${enc(id)}/status`, { id, body: { status } }),
    deleteFlow: (id: string) => call(authorization, flowDelete as Handler, 'DELETE', `/flows/${enc(id)}`, { id }),
    validateFlow: (body: unknown) =>
      call(authorization, flowValidate as Handler, 'POST', '/flows/validate', { body }),
    getBroadcast: (id: string) =>
      call(authorization, broadcastGet as Handler, 'GET', `/broadcasts/${enc(id)}`, { id }),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
