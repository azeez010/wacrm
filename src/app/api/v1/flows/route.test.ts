import { beforeEach, describe, expect, it, vi } from 'vitest'

const st = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ error: null as { message: string } | null })),
  deleted: [] as string[],
}))

function builder(table: string) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'order', 'limit', 'or', 'insert']) b[m] = () => b
  b.delete = () => ({ eq: (_c: string, id: string) => { st.deleted.push(`${table}:${id}`); return Promise.resolve({}) } })
  b.single = async () => ({ data: { id: 'f-1', name: 'Menu', status: 'draft' }, error: null })
  b.then = (r: (v: unknown) => unknown) => r({ data: [], count: 0, error: null })
  return b
}

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({
    supabase: { from: (t: string) => builder(t), rpc: (...a: unknown[]) => st.rpc(...(a as [])) },
    accountId: 'acct-1', keyId: 'k', scopes: ['flows:write'], createdBy: null, authType: 'api_key',
  })),
}))
vi.mock('@/lib/api/v1/contacts', () => ({ resolveAuditUserId: vi.fn(async () => 'user-1') }))
vi.mock('@/lib/billing/entitlements', async () => {
  const actual = await vi.importActual<typeof import('@/lib/billing/entitlements')>('@/lib/billing/entitlements')
  return { ...actual, assertFeature: vi.fn(async () => {}), assertWithinLimit: vi.fn(async () => {}) }
})

import { POST } from './route'

const post = (body: unknown) =>
  POST(
    new Request('http://x/api/v1/flows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wacrm_live_x' },
      body: JSON.stringify(body),
    }),
  )

const nodes = [
  { node_key: 'start', node_type: 'start', config: { next_node_key: 'hi' } },
  { node_key: 'hi', node_type: 'send_message', config: { text: 'Hello', next_node_key: 'end' } },
  { node_key: 'end', node_type: 'end', config: {} },
]

beforeEach(() => {
  st.rpc.mockClear()
  st.rpc.mockResolvedValue({ error: null })
  st.deleted.length = 0
})

describe('POST /api/v1/flows', () => {
  it('creates a draft flow, writes the graph via replace_flow_graph_for_account and returns issues', async () => {
    const res = await post({
      name: 'Menu',
      trigger_type: 'keyword',
      trigger_config: { keywords: ['menu'] },
      entry_node_id: 'start',
      nodes,
    })
    expect(res.status).toBe(201)
    expect(st.rpc).toHaveBeenCalledWith('replace_flow_graph_for_account', expect.objectContaining({ p_flow_id: 'f-1', p_account_id: 'acct-1' }))
    const body = await res.json()
    expect(Array.isArray(body.data.issues)).toBe(true)
    expect(body.data.issues.some((i: { severity: string }) => i.severity === 'error')).toBe(false)
  })

  it('rolls the flow back and answers 400 when the graph is rejected', async () => {
    st.rpc.mockResolvedValue({ error: { message: 'duplicate node_key' } })
    const res = await post({ name: 'Menu', trigger_type: 'manual', nodes })
    expect(res.status).toBe(400)
    expect(st.deleted).toContain('flows:f-1')
  })

  it('rejects bad trigger/node types before touching the database', async () => {
    expect((await post({ name: 'X', trigger_type: 'psychic' })).status).toBe(400)
    expect(
      (await post({ name: 'X', trigger_type: 'manual', nodes: [{ node_key: 'a', node_type: 'teleport', config: {} }] })).status,
    ).toBe(400)
    expect(st.rpc).not.toHaveBeenCalled()
  })
})
