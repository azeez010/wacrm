import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CRM_LISTS } from './attributes'
import { eventTag, fieldKey, ogadeskCrmProvider, resetOgadeskSchemaCache } from './ogadesk'

type Call = { method: string; path: string; body: Record<string, unknown> | null; auth: string | null }

function server(opts: { fields?: string[]; contactTags?: string[]; status?: number } = {}) {
  const calls: Call[] = []
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url))
    const call: Call = { method: init?.method ?? 'GET', path: u.pathname, body: init?.body ? JSON.parse(String(init.body)) : null, auth: (init?.headers as Record<string, string>).authorization ?? null }
    calls.push(call)
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status })
    if (opts.status) return json(opts.status, { error: { message: 'nope' } })
    if (call.path === '/api/v1/custom-fields' && call.method === 'GET') return json(200, { data: (opts.fields ?? []).map((key) => ({ key })) })
    if (call.path === '/api/v1/custom-fields') return json(201, { data: { key: call.body!.key } })
    if (call.path === '/api/v1/contacts') return json(200, { data: { id: 'c1', name: 'x', tags: (opts.contactTags ?? []).map((name) => ({ name })) } })
    if (call.path === '/api/v1/contacts/c1') return json(200, { data: { id: 'c1' } })
    return json(404, {})
  }) as unknown as typeof fetch
  return { f, calls }
}

const contact = {
  externalId: 'u1',
  email: 'ada@example.com',
  attributes: { FIRSTNAME: 'Ada', PLAN: 'pro', SIGNED_UP_AT: '2026-11-20T10:00:00Z', WHATSAPP_CONNECTED: true, MESSAGES_THIS_MONTH: 12, NOT_A_FIELD: 'x' },
  lists: [CRM_LISTS.all, CRM_LISTS.support],
}

beforeEach(() => resetOgadeskSchemaCache())

describe('OgaDesk CRM provider', () => {
  it('creates missing fields once, upserts by email and keeps hand-added tags', async () => {
    const { f, calls } = server({ fields: [fieldKey('PLAN')], contactTags: ['VIP', CRM_LISTS.marketing, 'Use case: Sales'] })
    const p = ogadeskCrmProvider({ baseUrl: 'https://ogadesk.com/', apiKey: 'wacrm_live_k' }, f)
    await p.upsertContact(contact)

    const created = calls.filter((c) => c.path === '/api/v1/custom-fields' && c.method === 'POST').map((c) => c.body!.key)
    expect(created).toContain(fieldKey('SIGNED_UP_AT'))
    expect(created).toContain(fieldKey('LAST_EVENT'))
    expect(created).not.toContain(fieldKey('PLAN'))
    expect(created).not.toContain(fieldKey('FIRSTNAME'))
    expect(calls[0]!.auth).toBe('Bearer wacrm_live_k')

    expect(calls.find((c) => c.path === '/api/v1/contacts')!.body).toEqual({ email: 'ada@example.com', name: 'Ada' })
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(patch.path).toBe('/api/v1/contacts/c1')
    // VIP kept; stale managed tags (marketing opt-in, sales) removed; wanted ones set.
    expect(patch.body!.tags).toEqual(['VIP', CRM_LISTS.all, CRM_LISTS.support])
    expect(patch.body!.custom_fields).toMatchObject({ [fieldKey('PLAN')]: 'pro', [fieldKey('SIGNED_UP_AT')]: '2026-11-20', [fieldKey('WHATSAPP_CONNECTED')]: true, [fieldKey('MESSAGES_THIS_MONTH')]: 12 })
    expect(patch.body!.custom_fields).not.toHaveProperty(fieldKey('NOT_A_FIELD'))

    const before = calls.length
    await p.upsertContact(contact)
    expect(calls.slice(before).some((c) => c.path === '/api/v1/custom-fields')).toBe(false) // schema cached
  })

  it('records an event as a tag and the last-event fields', async () => {
    const { f, calls } = server({ fields: [], contactTags: ['VIP'] })
    await ogadeskCrmProvider({ baseUrl: 'https://ogadesk.com', apiKey: 'k' }, f).trackEvent({ name: 'quota_80', email: 'ada@example.com', at: '2026-11-27T09:00:00Z' })
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(patch.body).toEqual({ tags: ['VIP', eventTag('quota_80')], custom_fields: { [fieldKey('LAST_EVENT')]: 'quota_80', [fieldKey('LAST_EVENT_AT')]: '2026-11-27' } })
  })

  it('marks 5xx/429 retryable and 4xx permanent', async () => {
    const p5 = ogadeskCrmProvider({ baseUrl: 'https://ogadesk.com', apiKey: 'k' }, server({ status: 503 }).f)
    await expect(p5.upsertContact(contact)).rejects.toMatchObject({ retryable: true })
    resetOgadeskSchemaCache()
    const p4 = ogadeskCrmProvider({ baseUrl: 'https://ogadesk.com', apiKey: 'k' }, server({ status: 403 }).f)
    await expect(p4.upsertContact(contact)).rejects.toMatchObject({ retryable: false, status: 403 })
  })
})
