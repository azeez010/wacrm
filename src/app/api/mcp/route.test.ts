import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'bad' | 'locked' }))

vi.mock('@/lib/auth/api-context', async () => {
  const { ApiError } = await import('@/lib/api/v1/respond')
  return {
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
    expect(tools).toEqual(['filter_contacts', 'get_contact', 'list_contacts', 'list_tags', 'whoami'])
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
