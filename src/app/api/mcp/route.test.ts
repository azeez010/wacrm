import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'bad' | 'locked' }))

vi.mock('@/lib/auth/api-context', async () => {
  const { ApiError } = await import('@/lib/api/v1/respond')
  const actual = await vi.importActual<typeof import('@/lib/auth/api-context')>('@/lib/auth/api-context')
  return {
    // The real header parsing (Bearer or X-API-Key); only the key lookup is faked.
    extractKey: actual.extractKey,
    requireApiKey: vi.fn(async () => {
      if (auth.mode === 'bad') throw new ApiError('unauthorized', 'Invalid API key', 401)
      return { supabase: {}, accountId: 'a1', keyId: 'k1', scopes: ['contacts:read'], createdBy: null, authType: 'api_key' }
    }),
  }
})
vi.mock('@/lib/billing/entitlements', async () => {
  const actual = await vi.importActual<typeof import('@/lib/billing/entitlements')>('@/lib/billing/entitlements')
  return {
    ...actual,
    assertFeature: vi.fn(async () => {
      if (auth.mode === 'locked') throw new actual.FeatureLockedError('mcp', 'Free')
    }),
  }
})
vi.mock('@/lib/mcp/dispatch', () => ({
  ApiCallError: class extends Error {},
  createApiClient: () => ({}),
}))

import { POST, OPTIONS } from './route'

function rpc(body: unknown) {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer wacrm_live_x',
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  auth.mode = 'ok'
})

describe('POST /api/mcp', () => {
  it('initializes and lists scope-filtered tools over plain HTTP', async () => {
    const init = await POST(
      rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      }),
    )
    expect(init.status).toBe(200)
    expect((await init.json()).result.serverInfo.name).toBe('wacrm')

    const list = await POST(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
    const tools = (await list.json()).result.tools.map((t: { name: string }) => t.name).sort()
    // get_usage and get_playbook go to every key (no scope needed).
    expect(tools).toEqual(['filter_contacts', 'get_contact', 'get_playbook', 'get_usage', 'list_contacts', 'list_tags', 'whoami'])
  })

  it('connects with just ?key= in the URL (no headers) and a header still wins', async () => {
    const req = (url: string, headers: Record<string, string> = {}) =>
      new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
    const { requireApiKey } = await import('@/lib/auth/api-context')
    const spy = vi.mocked(requireApiKey)
    spy.mockClear()
    expect((await POST(req('http://localhost/api/mcp?key=wacrm_live_url'))).status).toBe(200)
    expect(spy.mock.calls[0][0].headers.get('x-api-key')).toBe('wacrm_live_url')
    spy.mockClear()
    await POST(req('http://localhost/api/mcp?key=wacrm_live_url', { Authorization: 'Bearer wacrm_live_header' }))
    expect(spy.mock.calls[0][0].headers.get('x-api-key')).toBeNull()
  })

  it('answers 401 with a WWW-Authenticate header for a bad key', async () => {
    auth.mode = 'bad'
    const res = await POST(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer')
  })

  it('answers 402 when the plan does not include MCP', async () => {
    auth.mode = 'locked'
    const res = await POST(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
    expect(res.status).toBe(402)
  })

  it('answers CORS preflight', async () => {
    const res = OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
  })
})
