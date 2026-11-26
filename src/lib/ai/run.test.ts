import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { encryptPlatformSecret } from '@/lib/payments/secrets'
import { runGeneration, type RunDeps } from './run'
import { AiError, type AiConfig } from './types'

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 5)))

type Inst = { id: string; kind: string; name: string; model: string; reason: string | null; row?: Record<string, unknown> }
function fakeAdmin(opts: { credits?: Record<string, unknown> | Error; route: Inst[] }) {
  const reports: { id: string; ok: boolean; error: string | null }[] = []
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'ai_credit_status') {
        if (opts.credits instanceof Error) return { data: null, error: { message: opts.credits.message } }
        return { data: opts.credits ?? { allowed: true, reason: null, used: 10, limit: 1000, remaining: 990, percent: 1 }, error: null }
      }
      if (fn === 'ai_route') return { data: opts.route.map(({ row: _r, ...e }) => e), error: null }
      if (fn === 'ai_instance_secrets') {
        const i = opts.route.find((r) => r.id === args.p_id)!
        return { data: { kind: i.kind, model: i.model, config: {}, secrets: i.row?.secrets ?? null, timeoutMs: 5000, priceIn: 1, priceOut: 2, ...(i.row ?? {}) }, error: null }
      }
      if (fn === 'ai_instance_report') { reports.push({ id: args.p_id as string, ok: args.p_ok as boolean, error: (args.p_error as string | null) ?? null }); return { data: null, error: null } }
      return { data: null, error: null }
    },
  }
  return { admin: admin as unknown as SupabaseClient, reports }
}

const platformConfig = { source: 'platform', provider: 'openai', model: '', apiKey: '', baseUrl: null } as unknown as AiConfig
const base = { systemPrompt: 'sys', messages: [{ role: 'user' as const, content: 'hi' }], accountId: 'acc', conversationId: 'conv', mode: 'draft' as const }
const usage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 }

let blob = ''
beforeEach(async () => {
  vi.stubEnv('PLATFORM_SECRETS_KEY', KEY)
  blob = await encryptPlatformSecret(JSON.stringify({ api_key: 'sk-test' }), KEY)
})

const deps = (admin: SupabaseClient, call: RunDeps['call'], log = vi.fn(async () => undefined)): RunDeps => ({ admin: () => admin, call, now: Date.now, log })

describe('runGeneration: platform failover', () => {
  it('uses the first instance, logs usage with its id, cost and attempts', async () => {
    const { admin, reports } = fakeAdmin({ route: [{ id: 'a', kind: 'openai', name: 'OpenAI', model: 'gpt', reason: null, row: { secrets: blob } }] })
    const call = vi.fn().mockResolvedValue({ text: 'Hello', usage })
    const log = vi.fn(async () => undefined)
    const r = await runGeneration({} as SupabaseClient, { ...base, config: platformConfig }, deps(admin, call, log))
    expect(r).toMatchObject({ text: 'Hello', source: 'platform', instanceId: 'a' })
    expect(call).toHaveBeenCalledWith('openai', expect.objectContaining({ apiKey: 'sk-test', model: 'gpt', timeoutMs: 5000 }))
    expect(log).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: 'platform', instanceId: 'a', provider: 'openai', usage, costUsd: 0.0002, mode: 'draft' }))
    expect(reports).toEqual([{ id: 'a', ok: true, error: null }])
  })

  it('fails over to the next instance on any failure, records both attempts and health', async () => {
    const { admin, reports } = fakeAdmin({ route: [
      { id: 'a', kind: 'openai', name: 'A', model: 'm1', reason: null, row: { secrets: blob } },
      { id: 'skip', kind: 'openai', name: 'Skipped', model: 'm', reason: 'cooling_down' },
      { id: 'b', kind: 'anthropic', name: 'B', model: 'm2', reason: null, row: { secrets: blob } },
    ] })
    const call = vi.fn().mockRejectedValueOnce(new AiError('rate limited', { code: 'rate_limited', status: 502 })).mockResolvedValueOnce({ text: 'From B', usage })
    const log = vi.fn(async () => undefined)
    const r = await runGeneration({} as SupabaseClient, { ...base, config: platformConfig }, deps(admin, call, log))
    expect(r).toMatchObject({ text: 'From B', instanceId: 'b' })
    expect(call.mock.calls.map((c) => c[0])).toEqual(['openai', 'anthropic'])
    expect(r.attempts.map((a) => [a.instanceId, a.ok, a.code])).toEqual([['a', false, 'rate_limited'], ['b', true, undefined]])
    expect(reports).toEqual([{ id: 'a', ok: false, error: 'rate limited' }, { id: 'b', ok: true, error: null }])
  })

  it('treats a missing key, a timeout or a network error as a failover too, and fails when every instance fails', async () => {
    const { admin } = fakeAdmin({ route: [
      { id: 'a', kind: 'openai', name: 'A', model: 'm', reason: null, row: { secrets: null } },
      { id: 'b', kind: 'deepseek', name: 'B', model: 'm', reason: null, row: { secrets: blob } },
    ] })
    const call = vi.fn().mockRejectedValue(new AiError('timeout', { code: 'timeout', status: 504 }))
    const log = vi.fn(async () => undefined)
    const err = await runGeneration({} as SupabaseClient, { ...base, config: platformConfig }, deps(admin, call, log)).catch((e) => e)
    expect(err).toMatchObject({ code: 'ai_unavailable', status: 503 })
    expect(call).toHaveBeenCalledTimes(1) // instance a had no key, so it was never called
    expect(log).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ failed: true, usage: null, source: 'platform' }))
  })

  it('compatible providers call the adapter with their fixed base URL', async () => {
    const { admin } = fakeAdmin({ route: [{ id: 'd', kind: 'deepseek', name: 'DeepSeek', model: 'deepseek-chat', reason: null, row: { secrets: blob } }] })
    const call = vi.fn().mockResolvedValue({ text: 'ok', usage })
    await runGeneration({} as SupabaseClient, { ...base, config: platformConfig }, deps(admin, call))
    expect(call).toHaveBeenCalledWith('openai_compatible', expect.objectContaining({ baseUrl: 'https://api.deepseek.com' }))
  })

  it('parses the handoff sentinel', async () => {
    const { admin } = fakeAdmin({ route: [{ id: 'a', kind: 'openai', name: 'A', model: 'm', reason: null, row: { secrets: blob } }] })
    const call = vi.fn().mockResolvedValue({ text: '[[HANDOFF]]', usage })
    const r = await runGeneration({} as SupabaseClient, { ...base, mode: 'auto_reply', config: platformConfig }, deps(admin, call))
    expect(r).toMatchObject({ handoff: true, text: '' })
  })
})

describe('runGeneration: credits and gates', () => {
  it('refuses with 402 when credits are used up or the plan has no AI, without calling any provider', async () => {
    const call = vi.fn()
    for (const [reason, code] of [['credits_exhausted', 'ai_credits_exhausted'], ['plan_feature', 'ai_plan_feature']] as const) {
      const { admin } = fakeAdmin({ credits: { allowed: false, reason, used: 1000, limit: 1000, remaining: 0, percent: 100 }, route: [{ id: 'a', kind: 'openai', name: 'A', model: 'm', reason: null, row: { secrets: blob } }] })
      const err = await runGeneration({} as SupabaseClient, { ...base, config: platformConfig }, deps(admin, call)).catch((e) => e)
      expect(err).toMatchObject({ code, status: 402 })
    }
    expect(call).not.toHaveBeenCalled()
  })

  it('fails closed when the credit check itself errors (never spend unchecked)', async () => {
    const { admin } = fakeAdmin({ credits: new Error('db down'), route: [{ id: 'a', kind: 'openai', name: 'A', model: 'm', reason: null, row: { secrets: blob } }] })
    const call = vi.fn()
    expect(await runGeneration({} as SupabaseClient, { ...base, config: platformConfig }, deps(admin, call)).catch((e) => e)).toMatchObject({ code: 'ai_unavailable' })
    expect(call).not.toHaveBeenCalled()
  })

  it('says AI is unavailable when no instance is eligible', async () => {
    const { admin } = fakeAdmin({ route: [{ id: 'a', kind: 'openai', name: 'A', model: 'm', reason: 'disabled' }] })
    expect(await runGeneration({} as SupabaseClient, { ...base, config: platformConfig }, deps(admin, vi.fn())).catch((e) => e)).toMatchObject({ code: 'ai_unavailable', status: 503 })
  })

  it('a business with its own key never touches credits or instances', async () => {
    const own = { source: 'own', provider: 'openai', model: 'gpt', apiKey: 'sk-own', baseUrl: null } as unknown as AiConfig
    const admin = { rpc: vi.fn() } as unknown as SupabaseClient
    const log = vi.fn(async () => undefined)
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Own reply' } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const r = await runGeneration({} as SupabaseClient, { ...base, config: own }, { admin: () => admin, call: vi.fn(), now: Date.now, log })
      expect(r).toMatchObject({ text: 'Own reply', source: 'own', instanceId: null })
      expect(admin.rpc).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ provider: 'openai', model: 'gpt' }))
      expect((log.mock.calls as unknown as unknown[][])[0]![1]).not.toHaveProperty('source')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
