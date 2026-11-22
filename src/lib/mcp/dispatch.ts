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
import { GET as fieldsGet, POST as fieldsPost } from '@/app/api/v1/custom-fields/route'
import { PATCH as fieldPatch, DELETE as fieldDelete } from '@/app/api/v1/custom-fields/[id]/route'
import { GET as tablesGet, POST as tablesPost } from '@/app/api/v1/tables/route'
import {
  GET as tableGet,
  PATCH as tablePatch,
  DELETE as tableDelete,
} from '@/app/api/v1/tables/[id]/route'
import { GET as recordsGet, POST as recordsPost } from '@/app/api/v1/tables/[id]/records/route'
import {
  PATCH as recordPatch,
  DELETE as recordDelete,
} from '@/app/api/v1/tables/[id]/records/[recordId]/route'
import { GET as segmentsGet, POST as segmentsPost } from '@/app/api/v1/segments/route'
import {
  GET as segmentGet,
  PATCH as segmentPatch,
  DELETE as segmentDelete,
} from '@/app/api/v1/segments/[id]/route'
import { GET as segmentContactsGet } from '@/app/api/v1/segments/[id]/contacts/route'
import { POST as contactsFilterPost } from '@/app/api/v1/contacts/filter/route'

type Handler = (req: Request, ctx: { params: Promise<{ id: string; recordId?: string }> }) => Promise<Response>

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
  opts: { query?: Record<string, string | number | undefined>; body?: unknown; id?: string; recordId?: string } = {},
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
    { params: Promise.resolve({ id: opts.id ?? '', recordId: opts.recordId }) },
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
    listCustomFields: (q: Record<string, string | number | undefined>) =>
      call(authorization, fieldsGet as Handler, 'GET', '/custom-fields', { query: q }),
    createCustomField: (body: unknown) =>
      call(authorization, fieldsPost as Handler, 'POST', '/custom-fields', { body }),
    updateCustomField: (id: string, body: unknown) =>
      call(authorization, fieldPatch as Handler, 'PATCH', `/custom-fields/${enc(id)}`, { id, body }),
    deleteCustomField: (id: string, purge?: boolean) =>
      call(authorization, fieldDelete as Handler, 'DELETE', `/custom-fields/${enc(id)}`, {
        id,
        query: { purge: purge ? 'true' : undefined },
      }),
    listTables: () => call(authorization, tablesGet as Handler, 'GET', '/tables'),
    getTable: (id: string) => call(authorization, tableGet as Handler, 'GET', `/tables/${enc(id)}`, { id }),
    createTable: (body: unknown) => call(authorization, tablesPost as Handler, 'POST', '/tables', { body }),
    updateTable: (id: string, body: unknown) =>
      call(authorization, tablePatch as Handler, 'PATCH', `/tables/${enc(id)}`, { id, body }),
    deleteTable: (id: string) =>
      call(authorization, tableDelete as Handler, 'DELETE', `/tables/${enc(id)}`, { id }),
    listRecords: (id: string, q: Record<string, string | number | undefined>) =>
      call(authorization, recordsGet as Handler, 'GET', `/tables/${enc(id)}/records`, { id, query: q }),
    createRecord: (id: string, values: unknown) =>
      call(authorization, recordsPost as Handler, 'POST', `/tables/${enc(id)}/records`, { id, body: { values } }),
    updateRecord: (id: string, recordId: string, values: unknown) =>
      call(authorization, recordPatch as Handler, 'PATCH', `/tables/${enc(id)}/records/${enc(recordId)}`, {
        id,
        recordId,
        body: { values },
      }),
    deleteRecord: (id: string, recordId: string) =>
      call(authorization, recordDelete as Handler, 'DELETE', `/tables/${enc(id)}/records/${enc(recordId)}`, {
        id,
        recordId,
      }),
    listSegments: () => call(authorization, segmentsGet as Handler, 'GET', '/segments'),
    getSegment: (id: string) =>
      call(authorization, segmentGet as Handler, 'GET', `/segments/${enc(id)}`, { id }),
    createSegment: (body: unknown) =>
      call(authorization, segmentsPost as Handler, 'POST', '/segments', { body }),
    updateSegment: (id: string, body: unknown) =>
      call(authorization, segmentPatch as Handler, 'PATCH', `/segments/${enc(id)}`, { id, body }),
    deleteSegment: (id: string) =>
      call(authorization, segmentDelete as Handler, 'DELETE', `/segments/${enc(id)}`, { id }),
    listSegmentContacts: (id: string, q: Record<string, string | number | undefined>) =>
      call(authorization, segmentContactsGet as Handler, 'GET', `/segments/${enc(id)}/contacts`, { id, query: q }),
    filterContacts: (body: unknown) =>
      call(authorization, contactsFilterPost as Handler, 'POST', '/contacts/filter', { body }),
    getBroadcast: (id: string) =>
      call(authorization, broadcastGet as Handler, 'GET', `/broadcasts/${enc(id)}`, { id }),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
