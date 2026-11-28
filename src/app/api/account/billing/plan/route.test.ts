import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ role: 'admin', plan: { id: 'starter', name: 'Starter' } as { id: string; name: string } | null, upserts: [] as unknown[] }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => {
    if (h.role !== 'admin') throw new Error('forbidden')
    return { accountId: 'acc-1', userId: 'u1' }
  }),
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth' }, { status: 403 })),
}))
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: () => Promise.resolve({ data: table === 'plans' ? h.plan : null }),
        upsert: (row: unknown) => {
          h.upserts.push(row)
          return Promise.resolve({ error: null })
        },
      }
      return b
    },
  }),
}))

import { POST } from './route'

const req = (body: unknown) => new Request('http://x/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  h.role = 'admin'
  h.plan = { id: 'starter', name: 'Starter' }
  h.upserts = []
  delete process.env.BILLING_MANUAL_SWITCH
})

describe('POST /api/account/billing/plan', () => {
  it('refuses a free switch to a paid plan: paid plans go through checkout', async () => {
    const res = await POST(req({ plan_id: 'starter' }))
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toBe('payment_required')
    expect(h.upserts).toHaveLength(0)
  })
  it('still lets a workspace move down to Free', async () => {
    h.plan = { id: 'free', name: 'Free' }
    const res = await POST(req({ plan_id: 'free' }))
    expect(res.status).toBe(200)
    expect(h.upserts[0]).toMatchObject({ account_id: 'acc-1', plan_id: 'free', status: 'active', provider: null })
  })
  it('BILLING_MANUAL_SWITCH=on keeps the old behaviour for staging', async () => {
    process.env.BILLING_MANUAL_SWITCH = 'on'
    const res = await POST(req({ plan_id: 'starter' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ plan_id: 'starter', plan_name: 'Starter' })
  })
  it('unknown plan is 400, missing plan_id is 400, non-admin is refused', async () => {
    h.plan = null
    expect((await POST(req({ plan_id: 'free' }))).status).toBe(400)
    expect((await POST(req({ plan_id: 'nope' }))).status).toBe(403)
    expect((await POST(req({}))).status).toBe(400)
    h.role = 'agent'
    expect((await POST(req({ plan_id: 'free' }))).status).toBe(403)
    expect(h.upserts).toHaveLength(0)
  })
  it('the kill switch turns it off', async () => {
    process.env.BILLING_MANUAL_SWITCH = 'off'
    expect((await POST(req({ plan_id: 'free' }))).status).toBe(403)
    expect(h.upserts).toHaveLength(0)
  })
})
