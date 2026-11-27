import { describe, expect, it, vi, beforeEach } from 'vitest'

const st = vi.hoisted(() => ({
  createdBy: 'user-1' as string | null,
  eqs: [] as [string, string, unknown][],
  rpc: vi.fn(),
}))

function builder(table: string) {
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.order = () => b
  b.in = () => Promise.resolve({ data: [{ account_id: 'ws-a', plan_id: 'pro', status: 'active' }], error: null })
  b.eq = (col: string, val: unknown) => {
    st.eqs.push([table, col, val])
    return b
  }
  b.then = (r: (v: unknown) => unknown) =>
    r({
      data: [
        { account_id: 'ws-a', account_role: 'owner', created_at: '1', accounts: { name: 'A' } },
        { account_id: 'ws-b', account_role: 'agent', created_at: '2', accounts: [{ name: 'B' }] },
      ],
      error: null,
    })
  return b
}

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: async () => ({
    authType: 'api_key',
    accountId: 'ws-a',
    keyId: 'k',
    scopes: ['workspaces:manage', 'workspace:manage'],
    createdBy: st.createdBy,
    supabase: { from: (t: string) => builder(t), rpc: st.rpc },
  }),
}))
vi.mock('@/lib/crm', () => ({ crmSyncUser: async () => undefined }))
vi.mock('@/lib/onboarding/hooks', () => ({ onWorkspaceChanged: async () => undefined }))

import { GET, POST } from './route'
import { PATCH as memberPatch } from '../team/[id]/route'

const req = (body?: unknown) =>
  new Request('https://x/api/v1/workspaces', { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined })

beforeEach(() => {
  st.createdBy = 'user-1'
  st.eqs = []
  st.rpc.mockReset()
})

describe('/api/v1/workspaces', () => {
  it("lists only the key creator's memberships and marks this key's workspace", async () => {
    const res = await GET(req())
    const body = (await res.json()) as { data: { id: string; name: string; this_key: boolean; plan_id: string }[] }
    expect(st.eqs).toContainEqual(['account_members', 'user_id', 'user-1'])
    expect(body.data.map((w) => [w.id, w.name, w.this_key])).toEqual([
      ['ws-a', 'A', true],
      ['ws-b', 'B', false],
    ])
    expect(body.data[0].plan_id).toBe('pro')
  })

  it('refuses when the key creator is gone', async () => {
    st.createdBy = null
    expect((await GET(req())).status).toBe(403)
    expect((await POST(req({ name: 'New' }))).status).toBe(403)
  })

  it('creates through api_create_workspace for the creator and turns the workspace limit into a 402', async () => {
    st.rpc.mockResolvedValueOnce({ data: 'ws-new', error: null })
    const ok = await POST(req({ name: '  Lagos branch ' }))
    expect(ok.status).toBe(201)
    expect(st.rpc).toHaveBeenCalledWith('api_create_workspace', { p_user: 'user-1', p_name: 'Lagos branch' })

    st.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'plan_limit:workspaces:3' } })
    expect((await POST(req({ name: 'Fourth' }))).status).toBe(402)
    expect((await POST(req({ name: '' }))).status).toBe(400)
  })
})

describe('PATCH /api/v1/team/{id}', () => {
  const id = '11111111-2222-4333-8444-555555555555'
  const patch = (role: string) =>
    memberPatch(new Request(`https://x/api/v1/team/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) }), { params: Promise.resolve({ id }) })

  it('never makes anyone owner', async () => {
    expect((await patch('owner')).status).toBe(400)
    expect(st.rpc).not.toHaveBeenCalled()
  })

  it('maps the database refusals', async () => {
    st.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'must be an admin' } })
    expect((await patch('viewer')).status).toBe(403)
    st.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0002', message: 'Not a member' } })
    expect((await patch('viewer')).status).toBe(404)
    st.rpc.mockResolvedValueOnce({ data: null, error: null })
    expect((await patch('viewer')).status).toBe(200)
    expect(st.rpc).toHaveBeenLastCalledWith('api_set_member_role', { p_account: 'ws-a', p_actor: 'user-1', p_user: id, p_role: 'viewer' })
  })
})
