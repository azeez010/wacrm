import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_MANAGED_LISTS, CRM_ATTRIBUTES, CRM_LISTS } from './attributes'
import { brevoProvider, resetBrevoSchemaCache } from './brevo'
import { CrmError } from './types'

type Call = { url: string; method: string; body: unknown }
let calls: Call[] = []
let handler: (c: Call) => { status?: number; body?: unknown }

function json(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status })
}

beforeEach(() => {
  process.env.BREVO_API_KEY = 'xkeysib-test'
  delete process.env.BREVO_FOLDER_ID
  calls = []
  resetBrevoSchemaCache()
  handler = () => ({ status: 200, body: {} })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call = { url: url.replace('https://api.brevo.com/v3', ''), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body as string) : undefined }
      calls.push(call)
      const r = handler(call)
      return json(r.status ?? 200, r.body)
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

/** A Brevo account that already has some attributes and lists. */
function account(opts: { attrs?: string[]; lists?: Array<{ id: number; name: string }>; folders?: Array<{ id: number; name: string }> } = {}) {
  let nextList = 100
  handler = (c) => {
    if (c.url === '/contacts/attributes' && c.method === 'GET') return { body: { attributes: (opts.attrs ?? []).map((name) => ({ name })) } }
    if (c.url.startsWith('/contacts/attributes/normal/')) return { status: 201 }
    if (c.url.startsWith('/contacts/lists?') ) return { body: { lists: offsetPage(opts.lists ?? [], c.url) } }
    if (c.url === '/contacts/lists' && c.method === 'POST') return { status: 201, body: { id: nextList++ } }
    if (c.url.startsWith('/contacts/folders?')) return { body: { folders: opts.folders ?? [] } }
    if (c.url === '/contacts/folders' && c.method === 'POST') return { status: 201, body: { id: 7 } }
    if (c.method === 'PUT') return { status: 204 }
    if (c.url === '/contacts' && c.method === 'POST') return { status: 201, body: { id: 1 } }
    if (c.url === '/events') return { status: 204 }
    if (c.url === '/smtp/email') return { status: 201, body: { messageId: '<m1>' } }
    return { status: 200 }
  }
}
function offsetPage(lists: Array<{ id: number; name: string }>, url: string) {
  const offset = Number(new URL(`http://x${url}`).searchParams.get('offset') ?? 0)
  return lists.slice(offset, offset + 50)
}

describe('ensureSchema', () => {
  it('creates only the attributes and lists that are missing, in an OgaDesk folder', async () => {
    const have = Object.keys(CRM_ATTRIBUTES).slice(0, 5)
    account({ attrs: have, lists: [{ id: 5, name: `OgaDesk - ${CRM_LISTS.all}` }] })
    await brevoProvider.ensureSchema()
    const created = calls.filter((c) => c.url.startsWith('/contacts/attributes/normal/')).map((c) => c.url.split('/').pop())
    expect(created.sort()).toEqual(Object.keys(CRM_ATTRIBUTES).filter((a) => !have.includes(a)).sort())
    // types are sent
    expect(calls.find((c) => c.url.endsWith('/PLAN'))?.body).toEqual({ type: 'text' })
    expect(calls.find((c) => c.url.endsWith('/MARKETING_OPT_IN'))?.body).toEqual({ type: 'boolean' })
    expect(calls.find((c) => c.url.endsWith('/QUOTA_PERCENT'))?.body).toEqual({ type: 'float' })
    // folder created, then the five missing lists in it
    expect(calls.some((c) => c.url === '/contacts/folders' && c.method === 'POST')).toBe(true)
    const newLists = calls.filter((c) => c.url === '/contacts/lists' && c.method === 'POST')
    expect(newLists).toHaveLength(ALL_MANAGED_LISTS.length - 1)
    expect(newLists[0].body).toMatchObject({ folderId: 7 })
  })

  it('does nothing when everything exists, and caches the result', async () => {
    account({
      attrs: Object.keys(CRM_ATTRIBUTES),
      lists: ALL_MANAGED_LISTS.map((n, i) => ({ id: i + 1, name: `OgaDesk - ${n}` })),
    })
    await brevoProvider.ensureSchema()
    await brevoProvider.ensureSchema()
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0)
    expect(calls.filter((c) => c.url === '/contacts/attributes')).toHaveLength(1)
  })

  it('reads every page of lists and honours BREVO_FOLDER_ID', async () => {
    process.env.BREVO_FOLDER_ID = '42'
    const many = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, name: `Other ${i}` }))
    account({ attrs: Object.keys(CRM_ATTRIBUTES), lists: many })
    await brevoProvider.ensureSchema()
    expect(calls.filter((c) => c.url.startsWith('/contacts/lists?'))).toHaveLength(2)
    expect(calls.find((c) => c.url === '/contacts/lists' && c.method === 'POST')?.body).toMatchObject({ folderId: 42 })
    expect(calls.some((c) => c.url.startsWith('/contacts/folders'))).toBe(false)
  })
})

describe('upsertContact', () => {
  const ids = Object.fromEntries(ALL_MANAGED_LISTS.map((n, i) => [n, i + 1]))
  const setup = () =>
    account({ attrs: Object.keys(CRM_ATTRIBUTES), lists: ALL_MANAGED_LISTS.map((n) => ({ id: ids[n], name: `OgaDesk - ${n}` })) })

  it('updates an existing contact: adds wanted lists, unlinks the rest, drops nulls and unknown attributes', async () => {
    setup()
    await brevoProvider.upsertContact({
      externalId: 'u1',
      email: 'jane+test@example.com',
      attributes: { FIRSTNAME: 'Jane', PLAN: 'free', LASTNAME: null, NOT_A_THING: 'x', MARKETING_OPT_IN: false },
      lists: [CRM_LISTS.all, CRM_LISTS.developer],
    })
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.url).toBe('/contacts/jane%2Btest%40example.com')
    expect(put.body).toEqual({
      attributes: { FIRSTNAME: 'Jane', PLAN: 'free', MARKETING_OPT_IN: false },
      listIds: [ids[CRM_LISTS.all], ids[CRM_LISTS.developer]],
      unlinkListIds: ALL_MANAGED_LISTS.filter((n) => n !== CRM_LISTS.all && n !== CRM_LISTS.developer).map((n) => ids[n]),
    })
    expect(calls.some((c) => c.url === '/contacts' && c.method === 'POST')).toBe(false)
  })

  it('creates the contact when it does not exist yet (404 on update)', async () => {
    setup()
    const base = handler
    handler = (c) => (c.method === 'PUT' ? { status: 404, body: { message: 'Contact not found' } } : base(c))
    await brevoProvider.upsertContact({ externalId: 'u1', email: 'new@example.com', attributes: { PLAN: 'free' }, lists: [CRM_LISTS.all] })
    expect(calls.find((c) => c.url === '/contacts' && c.method === 'POST')?.body).toEqual({
      email: 'new@example.com',
      attributes: { PLAN: 'free' },
      listIds: [ids[CRM_LISTS.all]],
      updateEnabled: true,
    })
  })
})

describe('trackEvent and send', () => {
  it('posts an event identified by email', async () => {
    account()
    await brevoProvider.trackEvent({ name: 'whatsapp_connected', email: 'a@b.co', at: '2026-11-20T10:00:00Z', properties: { numbers: 1, new: true } })
    expect(calls[0]).toMatchObject({
      url: '/events',
      body: { event_name: 'whatsapp_connected', event_date: '2026-11-20T10:00:00Z', identifiers: { email_id: 'a@b.co' }, event_properties: { numbers: 1, new: true } },
    })
  })

  it('sends a transactional email with html only', async () => {
    account()
    const r = await brevoProvider.send({
      to: { email: 'a@b.co', name: 'A' },
      from: { email: 'hello@ogadesk.com', name: 'OgaDesk' },
      subject: 'Welcome',
      html: '<p>Hi</p>',
      text: 'Hi',
      tags: ['welcome'],
    })
    expect(r.id).toBe('<m1>')
    expect(calls[0].body).toEqual({
      sender: { email: 'hello@ogadesk.com', name: 'OgaDesk' },
      to: [{ email: 'a@b.co', name: 'A' }],
      subject: 'Welcome',
      htmlContent: '<p>Hi</p>',
      tags: ['welcome'],
    })
  })
})

describe('errors', () => {
  it('classifies failures: 429 and 5xx retry, other 4xx do not, no key does not', async () => {
    for (const [status, retryable] of [[429, true], [503, true], [400, false], [401, false]] as const) {
      handler = () => ({ status, body: { message: 'nope' } })
      const err = await brevoProvider.trackEvent({ name: 'x', email: 'a@b.co' }).catch((e) => e)
      expect(err).toBeInstanceOf(CrmError)
      expect(err.retryable).toBe(retryable)
      expect(err.message).toContain(String(status))
    }
    delete process.env.BREVO_API_KEY
    const err = await brevoProvider.trackEvent({ name: 'x', email: 'a@b.co' }).catch((e) => e)
    expect(err).toMatchObject({ retryable: false })
  })

  it('treats a network failure or timeout as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up') }))
    const err = await brevoProvider.trackEvent({ name: 'x', email: 'a@b.co' }).catch((e) => e)
    expect(err).toMatchObject({ retryable: true })
  })
})
