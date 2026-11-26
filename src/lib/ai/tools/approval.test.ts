import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (s: string) => s }))
import { decideToolCall, followUpInstruction } from './approval'

type Row = Record<string, unknown>

// In-memory tables with just the chain the approval code uses: select/update + eq + maybeSingle/select.
function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: [string, unknown][] = []
    let patch: Row | null = null
    const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v))
    const apply = () => {
      const hit = rows()
      if (patch) for (const r of hit) Object.assign(r, patch)
      return hit
    }
    const chain: Record<string, unknown> = {
      select: () => chain,
      update: (p: Row) => { patch = p; return chain },
      eq: (k: string, v: unknown) => { filters.push([k, v]); return chain },
      maybeSingle: () => Promise.resolve({ data: apply()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: apply(), error: null }).then(res),
    }
    return chain
  }
  return { from } as unknown as SupabaseClient
}

const NOW = Date.parse('2026-11-27T10:00:00Z')

function setup(overrides: Row = {}) {
  const call: Row = {
    id: 'c1', account_id: 'a1', status: 'pending_approval', expires_at: '2026-11-28T09:00:00Z',
    arguments: { amount: 15000, description: 'Deposit', card_pin: '1234' }, tool_id: 't1', integration_id: 'i1',
    tool_name: 'Paystack · Create a payment link', conversation_id: 'conv1', ...overrides,
  }
  const tables = {
    ai_tool_calls: [call],
    integrations: [{ id: 'i1', account_id: 'a1', kind: 'paystack', name: 'Paystack', status: 'connected', config: { currency: 'NGN' }, secrets: JSON.stringify({ secret_key: 'sk_test_x' }) }],
    integration_tools: [{ id: 't1', integration_id: 'i1', name: 'create_payment_link', title: 'Create a payment link', description: '', input_schema: {}, kind: 'action', enabled: true, auto_approve: false, config: {} }],
  }
  return { db: fakeDb(tables), call }
}

const paystackOk = vi.fn(async () => new Response(JSON.stringify({ status: true, data: { slug: 'abc123' } }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

describe('decideToolCall', () => {
  it('approves once: runs the action, stores the result and redacts the arguments', async () => {
    const { db, call } = setup()
    const out = await decideToolCall(db, { accountId: 'a1', callId: 'c1', userId: 'u1', decision: 'approve' }, { now: () => NOW, fetch: paystackOk })
    expect(out).toMatchObject({ status: 'approved', conversationId: 'conv1' })
    expect(out.status === 'approved' && out.result).toContain('paystack.com/pay/abc123')
    expect(call).toMatchObject({ status: 'approved', decided_by: 'u1' })
    expect((call.arguments as Row).card_pin).toBe('[redacted]')

    const again = await decideToolCall(db, { accountId: 'a1', callId: 'c1', userId: 'u2', decision: 'approve' }, { now: () => NOW, fetch: paystackOk })
    expect(again).toEqual({ status: 'conflict' })
  })

  it('rejects without running anything', async () => {
    const { db, call } = setup()
    const f = vi.fn() as unknown as typeof fetch
    expect(await decideToolCall(db, { accountId: 'a1', callId: 'c1', userId: 'u1', decision: 'reject' }, { now: () => NOW, fetch: f })).toEqual({ status: 'rejected' })
    expect(f).not.toHaveBeenCalled()
    expect(call.status).toBe('rejected')
  })

  it('expires after 24 hours', async () => {
    const { db, call } = setup({ expires_at: '2026-11-27T09:00:00Z' })
    expect(await decideToolCall(db, { accountId: 'a1', callId: 'c1', userId: 'u1', decision: 'approve' }, { now: () => NOW })).toEqual({ status: 'expired' })
    expect(call.status).toBe('expired')
  })

  it('does not decide another workspace\'s call', async () => {
    const { db } = setup()
    expect(await decideToolCall(db, { accountId: 'other', callId: 'c1', userId: 'u1', decision: 'approve' }, { now: () => NOW })).toEqual({ status: 'not_found' })
  })

  it('reports a paused integration as an error', async () => {
    const { call } = setup()
    const paused = fakeDb({
      ai_tool_calls: [call],
      integrations: [{ id: 'i1', account_id: 'a1', kind: 'paystack', name: 'P', status: 'disabled', config: {}, secrets: null }],
      integration_tools: [{ id: 't1', integration_id: 'i1', name: 'create_payment_link', kind: 'action', config: {} }],
    })
    const out = await decideToolCall(paused, { accountId: 'a1', callId: 'c1', userId: 'u1', decision: 'approve' }, { now: () => NOW })
    expect(out).toMatchObject({ status: 'error', result: 'The integration is paused.' })
  })
})

describe('followUpInstruction', () => {
  it('asks for the link on success and hides details on failure', () => {
    expect(followUpInstruction('Pay', 'https://paystack.com/pay/x', true)).toMatch(/include it exactly/)
    expect(followUpInstruction('Pay', 'HTTP 500', false)).toMatch(/Do not share technical details/)
  })
})
