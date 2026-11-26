import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (s: string) => s }))
import { loadToolRuntime } from './registry'

// A chainable stand-in for the few supabase calls the registry makes.
function fakeDb(tools: Record<string, unknown>[], opts: { feature?: boolean } = {}) {
  const inserted: Record<string, unknown>[] = []
  const q = (table: string) => {
    const chain: Record<string, unknown> = {}
    const ret = (data: unknown) => Promise.resolve({ data, error: null })
    const data = () => {
      if (table === 'account_subscriptions') return { plan_id: 'pro', status: 'active', limit_overrides: {}, feature_overrides: {} }
      if (table === 'plans') return { name: 'Pro', limits: {}, features: { ai_tools: opts.feature !== false } }
      if (table === 'integrations') return [{ id: 'i1', kind: 'paystack', name: 'Paystack', status: 'connected', config: { currency: 'NGN' }, secrets: JSON.stringify({ secret_key: 'sk_test_1' }) }]
      if (table === 'integration_tools') return tools
      return null
    }
    for (const m of ['select', 'eq', 'in', 'update']) chain[m] = () => chain
    chain.limit = () => ret(data())
    chain.maybeSingle = () => ret(data())
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: data(), error: null }).then(res)
    chain.insert = (row: Record<string, unknown>) => { inserted.push(row); return { select: () => ({ single: () => ret({ id: 'call1' }) }) } }
    return chain
  }
  return { db: { from: q } as unknown as SupabaseClient, inserted }
}

const linkTool = { id: 't1', integration_id: 'i1', name: 'create_payment_link', title: 'Create a payment link', description: 'Make a link', input_schema: { type: 'object', properties: { amount: { type: 'number' } } }, kind: 'action', enabled: true, auto_approve: false, config: {} }
const checkTool = { ...linkTool, id: 't2', name: 'check_payment', title: 'Check a payment', kind: 'read' }
const ctx = (mode: 'auto_reply' | 'draft' | 'playground' | 'manual') => ({ accountId: 'acc', conversationId: 'conv', agentId: null, mode })

describe('loadToolRuntime', () => {
  it('exposes enabled tools with namespaced names and an approval hint on actions', async () => {
    const { db } = fakeDb([linkTool, checkTool])
    const rt = (await loadToolRuntime(db, ctx('auto_reply')))!
    expect(rt.specs.map((s) => s.name)).toEqual(['paystack__create_payment_link', 'paystack__check_payment'])
    expect(rt.specs[0]!.description).toContain('a teammate may need to approve it')
  })

  it('auto-reply: an action without auto-approve is queued for a teammate (arguments kept for the approver), not run', async () => {
    const f = vi.fn()
    const { db, inserted } = fakeDb([linkTool])
    const rt = (await loadToolRuntime(db, ctx('auto_reply'), { fetch: f as unknown as typeof fetch }))!
    const out = await rt.execute({ id: 'c', name: 'paystack__create_payment_link', arguments: { amount: 15000 } })
    expect(out).toMatchObject({ pendingApproval: true })
    expect(f).not.toHaveBeenCalled()
    expect(inserted[0]).toMatchObject({ status: 'pending_approval', kind: 'action', arguments: { amount: 15000 }, conversation_id: 'conv' })
    expect(inserted[0]!.expires_at).toBeTruthy()
  })

  it('auto-reply with auto-approve, and a teammate approval (manual), run the action; drafts and playground only propose', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ status: true, data: { slug: 's1' } }), { status: 200 }))
    for (const [mode, tool] of [['auto_reply', { ...linkTool, auto_approve: true }], ['manual', linkTool]] as const) {
      const { db, inserted } = fakeDb([tool])
      const rt = (await loadToolRuntime(db, ctx(mode), { fetch: f as unknown as typeof fetch }))!
      const out = await rt.execute({ id: 'c', name: 'paystack__create_payment_link', arguments: { amount: 1, description: 'x' } })
      expect(out.content).toContain('https://paystack.com/pay/s1')
      expect(out.content).toContain('external data')
      await new Promise((r) => setTimeout(r, 0))
      expect(inserted[0]).toMatchObject({ status: 'ok' })
    }
    for (const mode of ['draft', 'playground'] as const) {
      const g = vi.fn()
      const { db, inserted } = fakeDb([linkTool])
      const rt = (await loadToolRuntime(db, ctx(mode), { fetch: g as unknown as typeof fetch }))!
      const out = await rt.execute({ id: 'c', name: 'paystack__create_payment_link', arguments: { amount: 1 } })
      expect(out.content).toMatch(/not run/i)
      expect(g).not.toHaveBeenCalled()
      expect(inserted[0]).toMatchObject({ status: 'proposed' })
    }
  })

  it('read tools run in every mode', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ status: true, data: { status: 'success', amount: 100, currency: 'NGN' } }), { status: 200 }))
    const { db } = fakeDb([checkTool])
    const rt = (await loadToolRuntime(db, ctx('draft'), { fetch: f as unknown as typeof fetch }))!
    expect((await rt.execute({ id: 'c', name: 'paystack__check_payment', arguments: { reference: 'REF123' } })).content).toContain('success')
  })

  it('no tools without the plan feature, or when the agent is limited to no integrations', async () => {
    expect(await loadToolRuntime(fakeDb([linkTool], { feature: false }).db, ctx('draft'))).toBeNull()
    expect(await loadToolRuntime(fakeDb([linkTool]).db, { ...ctx('draft'), allowedIntegrations: [] })).toBeNull()
  })
})
