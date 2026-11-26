import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AI_ADMIN_GATE_TTL_MS, checkAiAdminGate, invalidateAiAdminGate } from './admin-gate'

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => `plain:${v}` }))
import { loadAgentConfig, loadAiConfig } from './config'

type Rpc = { data: unknown; error: unknown }
const dbRpc = (reply: Rpc | (() => Promise<Rpc>)) => {
  const rpc = vi.fn(async () => (typeof reply === 'function' ? reply() : reply))
  return { db: { rpc } as unknown as SupabaseClient, rpc }
}

beforeEach(() => invalidateAiAdminGate())

describe('checkAiAdminGate', () => {
  it('allows by default, and reports the scope when blocked', async () => {
    expect(await checkAiAdminGate(dbRpc({ data: { allowed: true, scope: null }, error: null }).db, 'a1')).toEqual({ allowed: true, scope: null })
    expect(await checkAiAdminGate(dbRpc({ data: { allowed: false, scope: 'platform' }, error: null }).db, 'a2')).toEqual({ allowed: false, scope: 'platform' })
    expect(await checkAiAdminGate(dbRpc({ data: { allowed: false, scope: 'account' }, error: null }).db, 'a3')).toEqual({ allowed: false, scope: 'account' })
    // An unexpected scope value still blocks, as "account".
    expect(await checkAiAdminGate(dbRpc({ data: { allowed: false, scope: 'weird' }, error: null }).db, 'a4')).toEqual({ allowed: false, scope: 'account' })
  })

  it('fails open on an RPC error, a missing function, a thrown error or a junk answer', async () => {
    const open = { allowed: true, scope: null }
    expect(await checkAiAdminGate(dbRpc({ data: null, error: { message: 'function does not exist' } }).db, 'b1')).toEqual(open)
    expect(await checkAiAdminGate(dbRpc(async () => { throw new Error('network') }).db, 'b2')).toEqual(open)
    expect(await checkAiAdminGate(dbRpc({ data: 'nope', error: null }).db, 'b3')).toEqual(open)
    expect(await checkAiAdminGate({} as unknown as SupabaseClient, 'b4')).toEqual(open) // client without rpc()
  })

  it('caches for 30 s per account, never caches a failure, and can be invalidated', async () => {
    const { db, rpc } = dbRpc({ data: { allowed: false, scope: 'platform' }, error: null })
    let t = 1_000
    const now = () => t
    await checkAiAdminGate(db, 'c1', now)
    await checkAiAdminGate(db, 'c1', now)
    expect(rpc).toHaveBeenCalledTimes(1)
    await checkAiAdminGate(db, 'c2', now) // another account is its own entry
    expect(rpc).toHaveBeenCalledTimes(2)
    t += AI_ADMIN_GATE_TTL_MS + 1
    await checkAiAdminGate(db, 'c1', now)
    expect(rpc).toHaveBeenCalledTimes(3)
    invalidateAiAdminGate('c1')
    await checkAiAdminGate(db, 'c1', now)
    expect(rpc).toHaveBeenCalledTimes(4)

    const bad = dbRpc({ data: null, error: { message: 'boom' } })
    await checkAiAdminGate(bad.db, 'd1', now)
    await checkAiAdminGate(bad.db, 'd1', now)
    expect(bad.rpc).toHaveBeenCalledTimes(2) // errors are retried, not remembered
  })
})

describe('the gate applies to every AI use', () => {
  const ROW = {
    provider: 'openai', model: 'gpt-x', base_url: null, api_key: 'enc', system_prompt: null, is_active: true,
    auto_reply_enabled: true, auto_reply_max_per_conversation: 3, handoff_agent_id: null, embeddings_api_key: null,
  }
  const dbWith = (gate: Rpc) => {
    const chain: Record<string, unknown> = {
      from: () => chain, select: () => chain, eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: ROW, error: null }),
      then: (res: (v: unknown) => void) => res({ data: [], error: null }),
      rpc: vi.fn(async () => gate),
    }
    return chain as unknown as SupabaseClient
  }
  const allowed: Rpc = { data: { allowed: true, scope: null }, error: null }
  const paused = (scope: string): Rpc => ({ data: { allowed: false, scope }, error: null })

  it('loads the config when allowed', async () => {
    expect(await loadAiConfig(dbWith(allowed), 'e1')).not.toBeNull()
  })
  it.each(['platform', 'account'])('returns "not available" when paused for the %s, including the playground path', async (scope) => {
    invalidateAiAdminGate()
    expect(await loadAiConfig(dbWith(paused(scope)), 'e2')).toBeNull()
    invalidateAiAdminGate()
    expect(await loadAiConfig(dbWith(paused(scope)), 'e2', { requireActive: false })).toBeNull()
    invalidateAiAdminGate()
    expect(await loadAgentConfig(dbWith(paused(scope)), 'e2', { defaultAgent: true }, { requireActive: false })).toBeNull()
  })
  it('still works if the gate itself errors (fails open)', async () => {
    expect(await loadAiConfig(dbWith({ data: null, error: { message: 'down' } }), 'e3')).not.toBeNull()
  })
})
