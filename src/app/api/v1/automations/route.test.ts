import { beforeEach, describe, expect, it, vi } from 'vitest'

const st = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  limitHit: false,
  insertSteps: vi.fn(async () => null as string | null),
}))

function builder(table: string) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'order', 'limit', 'or', 'delete']) b[m] = () => b
  b.insert = (row: Record<string, unknown>) => {
    if (table === 'automations') st.inserted.push(row)
    return b
  }
  b.single = async () => ({ data: { id: 'a-1', ...(st.inserted[0] ?? {}) }, error: null })
  b.then = (r: (v: unknown) => unknown) => r({ data: [], count: 0, error: null })
  return b
}

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({
    supabase: { from: (t: string) => builder(t) },
    accountId: 'acct-1', keyId: 'k', scopes: ['automations:write'], createdBy: null, authType: 'api_key',
  })),
}))
vi.mock('@/lib/api/v1/contacts', () => ({ resolveAuditUserId: vi.fn(async () => 'user-1') }))
vi.mock('@/lib/automations/steps-tree', () => ({
  insertSteps: (...a: unknown[]) => st.insertSteps(...(a as [])),
  loadStepsTree: vi.fn(async () => []),
  replaceSteps: vi.fn(),
}))
vi.mock('@/lib/billing/entitlements', async () => {
  const actual = await vi.importActual<typeof import('@/lib/billing/entitlements')>('@/lib/billing/entitlements')
  return {
    ...actual,
    assertFeature: vi.fn(async () => {}),
    assertWithinLimit: vi.fn(async () => {
      if (st.limitHit) throw new actual.PlanLimitError('automations', 2, 'Free')
    }),
  }
})

import { POST } from './route'

const post = (body: unknown) =>
  POST(
    new Request('http://x/api/v1/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wacrm_live_x' },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  st.inserted.length = 0
  st.limitHit = false
  st.insertSteps.mockClear()
})

describe('POST /api/v1/automations', () => {
  it('saves an incomplete definition as an inactive draft and reports what is missing', async () => {
    const res = await post({
      name: 'Keyword reply',
      trigger_type: 'keyword_match',
      steps: [{ step_type: 'send_message', step_config: { text: 'hello' } }],
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(st.inserted[0]).toMatchObject({ account_id: 'acct-1', is_active: false, trigger_type: 'keyword_match' })
    expect(body.data.activation_issues.map((i: { path: string }) => i.path)).toContain('trigger.keywords')
  })

  it('refuses to activate while issues remain, and saves nothing', async () => {
    const res = await post({ name: 'X', trigger_type: 'keyword_match', is_active: true, steps: [] })
    expect(res.status).toBe(400)
    expect((await res.json()).error.issues.length).toBeGreaterThan(0)
    expect(st.inserted).toHaveLength(0)
  })

  it('creates an active automation when the definition is complete', async () => {
    const res = await post({
      name: 'Welcome',
      trigger_type: 'first_inbound_message',
      is_active: true,
      steps: [{ step_type: 'send_message', step_config: { text: 'Welcome!' } }],
    })
    expect(res.status).toBe(201)
    expect(st.inserted[0]).toMatchObject({ is_active: true })
    expect(st.insertSteps).toHaveBeenCalled()
  })

  it('rejects unknown trigger types with 400', async () => {
    expect((await post({ name: 'X', trigger_type: 'teleport' })).status).toBe(400)
  })

  it('answers 402 when the plan limit is reached', async () => {
    st.limitHit = true
    const res = await post({ name: 'X', trigger_type: 'new_message_received' })
    expect(res.status).toBe(402)
    expect((await res.json()).error.code).toBe('plan_limit')
  })
})
