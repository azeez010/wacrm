import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  role: 'admin' as 'admin' | 'agent',
  key: null as Record<string, unknown> | null,
  email: 'a@x.test' as string | null,
  pwOk: true,
  secret: 'wacrm_live_secret' as string | null,
  rate: true,
  updated: null as Record<string, unknown> | null,
  deleted: true,
  calls: [] as { op: string; filters: [string, unknown][]; payload?: unknown }[],
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => {
    if (h.role !== 'admin') throw new Error('forbidden')
    return {
      accountId: 'acc-1',
      userId: 'user-1',
      supabase: {
        auth: { getUser: async () => ({ data: { user: h.email ? { email: h.email } : null } }) },
        from: () => {
          const call = { op: 'select', filters: [] as [string, unknown][], payload: undefined as unknown }
          h.calls.push(call)
          const b: Record<string, unknown> = {
            select: () => b,
            update: (p: unknown) => ((call.op = 'update'), (call.payload = p), b),
            delete: () => ((call.op = 'delete'), b),
            eq: (k: string, v: unknown) => (call.filters.push([k, v]), b),
            is: (k: string, v: unknown) => (call.filters.push([k, v]), b),
            not: (k: string, _o: string, v: unknown) => (call.filters.push([`not ${k}`, v]), b),
            maybeSingle: () =>
              Promise.resolve({ data: call.op === 'update' ? h.updated : call.op === 'delete' ? (h.deleted ? { id: 'k' } : null) : h.key, error: null }),
          }
          return b
        },
      },
    }
  }),
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth' }, { status: 403 })),
}))
vi.mock('@/lib/api-keys/secrets', () => ({
  passwordIsCorrect: vi.fn(async () => h.pwOk),
  readKeySecret: vi.fn(async () => h.secret),
}))
vi.mock('@/lib/rate-limit', async (orig) => ({
  ...(await orig<typeof import('@/lib/rate-limit')>()),
  checkRateLimit: vi.fn(() => ({ success: h.rate, limit: 5, remaining: 0, resetAt: Date.now() + 1000 })),
  rateLimitResponse: vi.fn(() => Response.json({ error: 'slow down' }, { status: 429 })),
}))
vi.mock('@/lib/onboarding/hooks', () => ({ onWorkspaceChanged: vi.fn(async () => {}) }))

import { POST as reveal } from './reveal/route'
import { DELETE, PATCH } from './route'

const params = { params: Promise.resolve({ id: 'k1' }) }
const json = (url: string, method: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

beforeEach(() => {
  h.role = 'admin'
  h.key = { id: 'k1', revoked_at: null, expires_at: null }
  h.email = 'a@x.test'
  h.pwOk = true
  h.secret = 'wacrm_live_secret'
  h.rate = true
  h.updated = { id: 'k1', name: 'New', scopes: ['contacts:read'] }
  h.deleted = true
  h.calls = []
})

describe('reveal', () => {
  it('returns the key after the right password, never cached', async () => {
    const res = await reveal(json('/x', 'POST', { password: 'pw' }), params)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ plaintext: 'wacrm_live_secret' })
  })
  it('wrong password is 401 and reveals nothing', async () => {
    h.pwOk = false
    const res = await reveal(json('/x', 'POST', { password: 'bad' }), params)
    expect(res.status).toBe(401)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })
  it('older keys (no stored copy) return null', async () => {
    h.secret = null
    expect(await (await reveal(json('/x', 'POST', { password: 'pw' }), params)).json()).toEqual({ plaintext: null })
  })
  it('non-admins, missing password, revoked keys and rate limits are refused', async () => {
    h.role = 'agent'
    expect((await reveal(json('/x', 'POST', { password: 'pw' }), params)).status).toBe(403)
    h.role = 'admin'
    expect((await reveal(json('/x', 'POST', {}), params)).status).toBe(400)
    h.key = { id: 'k1', revoked_at: '2026-01-01', expires_at: null }
    expect((await reveal(json('/x', 'POST', { password: 'pw' }), params)).status).toBe(404)
    h.key = { id: 'k1', revoked_at: null, expires_at: null }
    h.rate = false
    expect((await reveal(json('/x', 'POST', { password: 'pw' }), params)).status).toBe(429)
  })
})

describe('PATCH (edit access)', () => {
  it('changes name and scopes of an active key', async () => {
    const res = await PATCH(json('/x', 'PATCH', { name: ' New ', scopes: ['contacts:read', 'contacts:read'] }), params)
    expect(res.status).toBe(200)
    const upd = h.calls.find((c) => c.op === 'update')!
    expect(upd.payload).toEqual({ name: 'New', scopes: ['contacts:read'] })
    expect(upd.filters).toEqual(expect.arrayContaining([['account_id', 'acc-1'], ['revoked_at', null]]))
  })
  it('rejects unknown scopes, empty bodies and revoked/missing keys', async () => {
    expect((await PATCH(json('/x', 'PATCH', { scopes: ['nope:all'] }), params)).status).toBe(400)
    expect((await PATCH(json('/x', 'PATCH', {}), params)).status).toBe(400)
    h.updated = null
    expect((await PATCH(json('/x', 'PATCH', { name: 'A' }), params)).status).toBe(404)
  })
})

describe('PATCH expiry', () => {
  it('sets a new expiry in days (capped at a year) or removes it with null', async () => {
    await PATCH(json('/x', 'PATCH', { expiresInDays: 30 }), params)
    const set = h.calls.find((c) => c.op === 'update')!.payload as { expires_at: string }
    const days = (new Date(set.expires_at).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(29.9)
    expect(days).toBeLessThan(30.1)
    h.calls = []
    await PATCH(json('/x', 'PATCH', { expiresInDays: 9999 }), params)
    expect((new Date((h.calls.find((c) => c.op === 'update')!.payload as { expires_at: string }).expires_at).getTime() - Date.now()) / 86_400_000).toBeLessThan(366)
    h.calls = []
    await PATCH(json('/x', 'PATCH', { expiresInDays: null }), params)
    expect(h.calls.find((c) => c.op === 'update')!.payload).toEqual({ expires_at: null })
    expect((await PATCH(json('/x', 'PATCH', { expiresInDays: 'soon' }), params)).status).toBe(400)
  })
})

describe('DELETE', () => {
  it('?permanent=1 deletes only a revoked key', async () => {
    const res = await DELETE(json('/x?permanent=1', 'DELETE'), params)
    expect(res.status).toBe(200)
    const del = h.calls.find((c) => c.op === 'delete')!
    expect(del.filters).toEqual(expect.arrayContaining([['account_id', 'acc-1'], ['not revoked_at', null]]))
  })
  it('permanent delete of an active key is a 404', async () => {
    h.deleted = false
    expect((await DELETE(json('/x?permanent=1', 'DELETE'), params)).status).toBe(404)
  })
})
