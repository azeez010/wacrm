import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  scopes: [] as string[],
  keyId: 'key-self',
  member: true as boolean,
  updated: { id: '11111111-1111-4111-8111-111111111111' } as Record<string, unknown> | null,
  calls: [] as { table: string; op: string; payload?: unknown; filters: [string, unknown][] }[],
  activeKeys: 0,
}))

const UUID = '11111111-1111-4111-8111-111111111111'

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async (_req: Request, scope?: string) => {
    if (scope && !h.scopes.includes(scope)) {
      const { forbidden } = await import('@/lib/api/v1/respond')
      throw forbidden(`missing ${scope}`)
    }
    return {
      accountId: 'acc-1',
      keyId: h.keyId,
      scopes: h.scopes,
      createdBy: 'user-1',
      supabase: {
        from(table: string) {
          const call = { table, op: 'select', filters: [] as [string, unknown][], payload: undefined as unknown }
          h.calls.push(call)
          const b: Record<string, unknown> = {
            select: (_c?: string, o?: { head?: boolean }) => ((o?.head ? (call.op = 'count') : 0), b),
            update: (p: unknown) => ((call.op = 'update'), (call.payload = p), b),
            insert: (p: unknown) => ((call.op = 'insert'), (call.payload = p), b),
            eq: (k: string, v: unknown) => (call.filters.push([k, v]), b),
            in: (k: string, v: unknown) => (call.filters.push([k, v]), b),
            is: (k: string, v: unknown) => (call.filters.push([k, v]), b),
            order: () => b,
            single: () => Promise.resolve({ data: { id: 'new-key', name: 'n', scopes: [] }, error: null }),
            maybeSingle: () =>
              Promise.resolve({
                data: table === 'profiles' ? (h.member ? { user_id: 'u' } : null) : call.op === 'update' ? h.updated : { id: UUID },
                error: null,
              }),
            then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], count: h.activeKeys, error: null }).then(res),
          }
          return b
        },
      },
    }
  }),
}))
vi.mock('@/lib/inbox/conversations', () => ({ CONVERSATION_SELECT: '*', normalizeConversation: (x: unknown) => x }))
vi.mock('@/lib/api/v1/conversations', () => ({ serializeConversation: (x: unknown) => x }))
vi.mock('@/lib/api-keys/secrets', () => ({ storeKeySecret: vi.fn(async () => true) }))
vi.mock('@/lib/billing/entitlements', async (orig) => ({ ...(await orig<typeof import('@/lib/billing/entitlements')>()), assertWithinLimit: vi.fn(async () => undefined) }))

import { PATCH as convPatch } from './conversations/[id]/route'
import { POST as keyPost } from './api-keys/route'
import { DELETE as keyDelete } from './api-keys/[id]/route'

const json = (method: string, body?: unknown) =>
  new Request('http://x/api/v1/x', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  h.scopes = []
  h.keyId = 'key-self'
  h.member = true
  h.updated = { id: UUID }
  h.calls = []
  h.activeKeys = 0
})

describe('PATCH /conversations/[id]', () => {
  it('needs conversations:write', async () => {
    expect((await convPatch(json('PATCH', { status: 'closed' }), ctx(UUID))).status).toBe(403)
  })
  it('closes and assigns, only to real team members', async () => {
    h.scopes = ['conversations:write']
    expect((await convPatch(json('PATCH', { status: 'closed', assigned_agent_id: UUID }), ctx(UUID))).status).toBe(200)
    const upd = h.calls.find((c) => c.op === 'update')!
    expect(upd.payload).toEqual({ status: 'closed', assigned_agent_id: UUID })
    expect(upd.filters).toEqual(expect.arrayContaining([['account_id', 'acc-1']]))
    h.member = false
    expect((await convPatch(json('PATCH', { assigned_agent_id: UUID }), ctx(UUID))).status).toBe(400)
  })
  it('rejects bad status, empty body, unknown id', async () => {
    h.scopes = ['conversations:write']
    expect((await convPatch(json('PATCH', { status: 'weird' }), ctx(UUID))).status).toBe(400)
    expect((await convPatch(json('PATCH', {}), ctx(UUID))).status).toBe(400)
    h.updated = null
    expect((await convPatch(json('PATCH', { status: 'open' }), ctx(UUID))).status).toBe(404)
  })
  it('unassign with null is allowed', async () => {
    h.scopes = ['conversations:write']
    expect((await convPatch(json('PATCH', { assigned_agent_id: null }), ctx(UUID))).status).toBe(200)
  })
})

describe('API key management', () => {
  it('needs keys:manage', async () => {
    h.scopes = ['contacts:read']
    expect((await keyPost(json('POST', { name: 'a', scopes: ['contacts:read'] }))).status).toBe(403)
  })
  it('mints a key with a subset of its scopes and returns the secret once', async () => {
    h.scopes = ['keys:manage', 'contacts:read', 'forms:read']
    const res = await keyPost(json('POST', { name: 'App', scopes: ['contacts:read'], expires_in_days: 30 }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.plaintext).toMatch(/^wacrm_live_/)
    const ins = h.calls.find((c) => c.op === 'insert')!.payload as Record<string, unknown>
    expect(ins).toMatchObject({ account_id: 'acc-1', created_by: 'user-1', scopes: ['contacts:read'] })
    expect(ins.key_hash).not.toBe(body.data.plaintext)
  })
  it('refuses escalation and keys:manage', async () => {
    h.scopes = ['keys:manage', 'contacts:read']
    expect((await keyPost(json('POST', { name: 'A', scopes: ['messages:send'] }))).status).toBe(403)
    expect((await keyPost(json('POST', { name: 'A', scopes: ['keys:manage'] }))).status).toBe(403)
    expect(h.calls.some((c) => c.op === 'insert')).toBe(false)
  })
  it('a key cannot revoke itself; others can be revoked within the account', async () => {
    h.scopes = ['keys:manage']
    h.keyId = UUID
    expect((await keyDelete(json('DELETE'), ctx(UUID))).status).toBe(400)
    h.keyId = 'someone-else'
    expect((await keyDelete(json('DELETE'), ctx(UUID))).status).toBe(200)
    expect(h.calls.find((c) => c.op === 'update')!.filters).toEqual(expect.arrayContaining([['account_id', 'acc-1'], ['revoked_at', null]]))
  })
})
