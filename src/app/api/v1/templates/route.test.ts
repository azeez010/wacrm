import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  scopes: ['templates:write'] as string[],
  submit: vi.fn(),
}))

vi.mock('@/lib/auth/api-context', async () => {
  const { ApiError } = await import('@/lib/api/v1/respond')
  return {
    requireApiKey: vi.fn(async (_req: Request, scope?: string) => {
      if (scope && !state.scopes.includes(scope)) throw new ApiError('forbidden', 'Missing scope', 403)
      return { supabase: {}, accountId: 'acct-1', keyId: 'k1', scopes: state.scopes, createdBy: null, authType: 'api_key' }
    }),
  }
})
vi.mock('@/lib/api/v1/contacts', () => ({ resolveAuditUserId: vi.fn(async () => 'user-1') }))
vi.mock('@/lib/whatsapp/template-submit', () => ({
  submitTemplateForAccount: (...a: unknown[]) => state.submit(...a),
}))

import { POST } from './route'

const req = (body: unknown) =>
  new Request('http://localhost/api/v1/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wacrm_live_x' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

beforeEach(() => {
  state.scopes = ['templates:write']
  state.submit.mockReset()
})

describe('POST /api/v1/templates', () => {
  it('needs the templates:write scope', async () => {
    state.scopes = ['templates:read']
    const res = await POST(req({ name: 'x' }))
    expect(res.status).toBe(403)
    expect(state.submit).not.toHaveBeenCalled()
  })

  it('wraps a successful submit in the v1 envelope as 201', async () => {
    state.submit.mockResolvedValue(Response.json({ success: true, template: { id: 't1', status: 'PENDING' } }))
    const res = await POST(req({ name: 'order_update', category: 'Utility', language: 'en_US', body_text: 'hi' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ data: { id: 't1', status: 'PENDING' } })
    expect(state.submit.mock.calls[0].slice(1, 3)).toEqual(['acct-1', 'user-1'])
  })

  it('maps pipeline failures onto v1 error codes', async () => {
    const cases: [number, string][] = [
      [400, 'bad_request'],
      [409, 'conflict'],
      [429, 'rate_limited'],
      [502, 'meta_error'],
    ]
    for (const [status, code] of cases) {
      state.submit.mockResolvedValue(Response.json({ error: 'nope' }, { status }))
      const res = await POST(req({ name: 'x' }))
      expect(res.status).toBe(status)
      expect((await res.json()).error.code).toBe(code)
    }
  })

  it('rejects a non-JSON body with 400', async () => {
    const res = await POST(req('not json'))
    expect(res.status).toBe(400)
    expect(state.submit).not.toHaveBeenCalled()
  })
})
