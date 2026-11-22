import { beforeEach, describe, expect, it, vi } from 'vitest'

const st = vi.hoisted(() => ({
  form: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
  count: 0,
  scopes: ['forms:manage'] as string[],
  limitHit: false,
  advancedLocked: false,
}))

function builder(table: string) {
  let op = 'select'
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'order', 'limit']) b[m] = () => b
  b.insert = (row: Record<string, unknown>) => { op = 'insert'; st.inserts.push({ table, ...row }); st.form = { id: 'f-new', public_id: 'abcdef0123456789', version: 1, archived_at: null, ...row }; return b }
  b.update = (row: Record<string, unknown>) => { op = 'update'; st.updates.push(row); if (st.form) st.form = { ...st.form, ...row }; return b }
  b.single = async () => ({ data: st.form, error: null })
  b.maybeSingle = async () => ({ data: st.form, error: null })
  b.then = (r: (v: unknown) => unknown) => r({ data: op === 'select' ? [] : null, count: st.count, error: null })
  return b
}

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async (_req: Request, scope?: string) => {
    if (scope && !st.scopes.includes(scope)) {
      const { forbidden } = await import('@/lib/api/v1/respond')
      throw forbidden(`needs ${scope}`)
    }
    return { supabase: { from: (t: string) => builder(t) }, accountId: 'acct-1', keyId: 'k', scopes: st.scopes, createdBy: null, authType: 'api_key' }
  }),
}))
vi.mock('@/lib/api/v1/contacts', () => ({ resolveAuditUserId: vi.fn(async () => 'user-1') }))
vi.mock('@/lib/billing/entitlements', async () => {
  const actual = await vi.importActual<typeof import('@/lib/billing/entitlements')>('@/lib/billing/entitlements')
  return {
    ...actual,
    assertFeature: vi.fn(async (_d: unknown, _a: string, feature: string) => {
      if (feature === 'forms_advanced' && st.advancedLocked) throw new actual.FeatureLockedError('forms_advanced', 'Free')
    }),
    assertWithinLimit: vi.fn(async () => {
      if (st.limitHit) throw new actual.PlanLimitError('forms_max', 2, 'Free')
    }),
  }
})

import { POST as create } from './route'
import { PATCH, DELETE, GET } from './[id]/route'

const req = (method: string, body?: unknown) =>
  new Request('http://x/api/v1/forms', { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer k' }, body: body === undefined ? undefined : JSON.stringify(body) })
const params = Promise.resolve({ id: 'f-1' })

beforeEach(() => {
  st.form = { id: 'f-1', public_id: 'abcdef0123456789', kind: 'lead', name: 'Gym', status: 'draft', version: 2, fields: [{ id: 'phone', kind: 'phone', label: '' }], settings: {}, rr_cursor: 0, archived_at: null, account_id: 'acct-1' }
  st.updates = []
  st.inserts = []
  st.scopes = ['forms:manage', 'forms:read']
  st.limitHit = false
  st.advancedLocked = false
})

describe('POST /api/v1/forms', () => {
  it('creates a DRAFT from a template and returns the link and embed code', async () => {
    const res = await create(req('POST', { template: 'contact', name: 'Contact us' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(st.inserts[0]).toMatchObject({ table: 'forms', status: 'draft', name: 'Contact us', account_id: 'acct-1', created_by: 'user-1' })
    expect(body.data.url).toMatch(/\/f\/[0-9a-f]{16}$/)
    expect(body.data.embed_script).toContain('data-ogadesk-form')
  })
  it('rejects an unknown template, a missing scope and the plan limit', async () => {
    expect((await create(req('POST', { template: 'nope' }))).status).toBe(400)
    st.scopes = ['forms:read']
    expect((await create(req('POST', {}))).status).toBe(403)
    st.scopes = ['forms:manage']
    st.limitHit = true
    expect((await create(req('POST', {}))).status).toBe(402)
  })
})

describe('/api/v1/forms/{id}', () => {
  it('GET returns the editable definition', async () => {
    const res = await GET(req('GET'), { params })
    const b = await res.json()
    expect(b.data.fields).toHaveLength(1)
    expect(b.data.settings).toEqual({})
  })
  it('PATCH validates (phone stays, strict settings) and bumps the version on field changes', async () => {
    expect((await PATCH(req('PATCH', { fields: [{ id: 'n', kind: 'name' }] }), { params })).status).toBe(400)
    expect((await PATCH(req('PATCH', { settings: { evil: 1 } }), { params })).status).toBe(400)
    const ok = await PATCH(req('PATCH', { status: 'active', fields: [{ id: 'phone', kind: 'phone' }, { id: 'name', kind: 'name' }] }), { params })
    expect(ok.status).toBe(200)
    expect(st.updates[0]).toMatchObject({ status: 'active', version: 3 })
  })
  it('PATCH gates scoring / round robin on forms_advanced', async () => {
    st.advancedLocked = true
    const res = await PATCH(req('PATCH', { settings: { qualification: { enabled: true, threshold: 3 } } }), { params })
    expect(res.status).toBe(402)
    expect(st.updates).toHaveLength(0)
  })
  it('PATCH and DELETE need forms:manage; DELETE archives, never deletes', async () => {
    st.scopes = ['forms:read']
    expect((await PATCH(req('PATCH', { name: 'x' }), { params })).status).toBe(403)
    expect((await DELETE(req('DELETE'), { params })).status).toBe(403)
    st.scopes = ['forms:manage']
    const res = await DELETE(req('DELETE'), { params })
    expect(res.status).toBe(200)
    expect(st.updates[0]).toMatchObject({ status: 'paused' })
    expect(st.updates[0].archived_at).toBeTruthy()
  })
  it('an archived form is not found', async () => {
    st.form = { ...(st.form as object), archived_at: '2026-01-01' }
    expect((await GET(req('GET'), { params })).status).toBe(404)
  })
})
