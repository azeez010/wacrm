import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { anthropicBody, openAiBody, parseAnthropic, parseOpenAi } from './provider-tools'
import { newLoopState, runToolLoop } from './loop'
import { BlockedUrlError, guardedFetch } from './guarded-fetch'
import { McpClient, parseRpcResponse, discoverMcpTools } from './executors/mcp'
import { buildRequest, runHttpAction } from './executors/http'
import { runPaystackTool } from './executors/paystack'
import { redact, toolSpecName } from './registry'
import type { ToolModelResult, ToolRuntime } from './types'

const publicCheck = async (u: string) => new URL(u)
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('provider tool formats', () => {
  const base = { apiKey: 'k', model: 'm', baseUrl: null, timeoutMs: 1000, systemPrompt: 'sys', messages: [{ role: 'user' as const, content: 'Book me Tuesday' }], tools: [{ name: 'cal__book', description: 'Book', inputSchema: { type: 'object', properties: { day: { type: 'string' } } } }] }
  const turns = [
    { role: 'assistant' as const, text: null, calls: [{ id: 'call_1', name: 'cal__book', arguments: { day: 'Tue' } }] },
    { role: 'tool' as const, results: [{ toolCallId: 'call_1', name: 'cal__book', content: 'booked' }] },
  ]
  it('OpenAI: tools as functions, assistant tool_calls then tool messages, tool_choice none on the last round', () => {
    const b = openAiBody({ ...base, turns, noTools: true }, 'max_completion_tokens') as Record<string, any>
    expect(b.tools[0]).toEqual({ type: 'function', function: { name: 'cal__book', description: 'Book', parameters: base.tools[0]!.inputSchema } })
    expect(b.tool_choice).toBe('none')
    expect(b.messages.slice(-2)).toEqual([
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'cal__book', arguments: '{"day":"Tue"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: 'booked' },
    ])
    expect(parseOpenAi({ choices: [{ message: { content: null, tool_calls: [{ id: 'c9', function: { name: 'x', arguments: '{"a":1}' } }] } }] })).toMatchObject({ text: '', toolCalls: [{ id: 'c9', name: 'x', arguments: { a: 1 } }] })
    expect(parseOpenAi({ choices: [{ message: { tool_calls: [{ function: { name: 'x', arguments: 'not json' } }] } }] }).toolCalls[0]!.arguments).toEqual({})
  })
  it('Anthropic: tool_use blocks in the assistant turn, tool_result blocks in a user turn', () => {
    const b = anthropicBody({ ...base, turns }) as Record<string, any>
    expect(b.tools[0]).toEqual({ name: 'cal__book', description: 'Book', input_schema: base.tools[0]!.inputSchema })
    expect(b.messages.slice(-2)).toEqual([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'cal__book', input: { day: 'Tue' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'booked' }] },
    ])
    expect(parseAnthropic({ content: [{ type: 'text', text: 'Checking' }, { type: 'tool_use', id: 'toolu_1', name: 'cal__book', input: { day: 'Tue' } }], usage: { input_tokens: 5, output_tokens: 3 } }))
      .toMatchObject({ text: 'Checking', toolCalls: [{ id: 'toolu_1', name: 'cal__book', arguments: { day: 'Tue' } }], usage: { totalTokens: 8 } })
  })
})

describe('tool loop', () => {
  const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
  const runtime = (execute: ToolRuntime['execute'], maxRounds = 4): ToolRuntime => ({ specs: [{ name: 'a__read', description: '', inputSchema: {} }, { name: 'a__act', description: '', inputSchema: {} }], execute, maxRounds })

  it('runs tools, feeds results back, sums usage and stops when the model answers', async () => {
    const execute = vi.fn(async () => ({ content: 'Tue 10:00 free' }))
    const replies: ToolModelResult[] = [
      { text: '', toolCalls: [{ id: '1', name: 'a__read', arguments: { day: 'Tue' } }], usage },
      { text: 'Tuesday at 10 works.', toolCalls: [], usage },
    ]
    const call = vi.fn(async () => replies.shift()!)
    const state = newLoopState()
    const r = await runToolLoop(call, runtime(execute), state)
    expect(r).toEqual({ text: 'Tuesday at 10 works.', usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 } })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(state.turns).toHaveLength(2)
  })

  it('caps the rounds and asks for a final answer without tools', async () => {
    const call = vi.fn(async (_t: unknown, noTools: boolean) => (noTools ? { text: 'Done.', toolCalls: [], usage: null } : { text: '', toolCalls: [{ id: String(Math.random()), name: 'a__read', arguments: { n: Math.random() } }], usage: null }))
    const r = await runToolLoop(call, runtime(async () => ({ content: 'x' }), 2), newLoopState())
    expect(r.text).toBe('Done.')
    expect(call).toHaveBeenCalledTimes(3)
    expect(call.mock.calls.at(-1)![1]).toBe(true)
  })

  it('a provider failover never executes the same action twice', async () => {
    const execute = vi.fn(async () => ({ content: 'booked' }))
    const state = newLoopState()
    // Provider A asks for the action, then dies before answering.
    const a = vi.fn().mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'A1', name: 'a__act', arguments: { day: 'Tue', time: '10' } }], usage: null }).mockRejectedValueOnce(new Error('timeout'))
    await expect(runToolLoop(a, runtime(execute), state)).rejects.toThrow('timeout')
    // Provider B continues from the same turns and asks again with the same arguments (keys in another order).
    const b = vi.fn().mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'B1', name: 'a__act', arguments: { time: '10', day: 'Tue' } }], usage: null }).mockResolvedValueOnce({ text: 'Booked.', toolCalls: [], usage: null })
    const r = await runToolLoop(b, runtime(execute), state)
    expect(r.text).toBe('Booked.')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('a pending approval stops further tool rounds; unknown tools and thrown errors become tool errors', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ content: 'needs approval', pendingApproval: true })
    const call = vi.fn()
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: '1', name: 'a__act', arguments: {} }, { id: '2', name: 'nope', arguments: {} }], usage: null })
      .mockResolvedValueOnce({ text: 'A teammate will confirm.', toolCalls: [], usage: null })
    const state = newLoopState()
    const r = await runToolLoop(call, runtime(execute), state)
    expect(r.text).toBe('A teammate will confirm.')
    expect(state.pendingApproval).toBe(true)
    expect(call.mock.calls[1]![1]).toBe(true) // no more tools after the pending action
    const results = (state.turns[1] as { results: { content: string; isError?: boolean }[] }).results
    expect(results[1]).toMatchObject({ isError: true, content: 'There is no tool called nope.' })
    const boom = vi.fn().mockRejectedValue(new Error('network'))
    const s2 = newLoopState()
    await runToolLoop(vi.fn().mockResolvedValueOnce({ text: '', toolCalls: [{ id: '1', name: 'a__read', arguments: {} }], usage: null }).mockResolvedValueOnce({ text: 'ok', toolCalls: [], usage: null }), runtime(boom), s2)
    expect((s2.turns[1] as { results: { content: string }[] }).results[0]!.content).toContain('The tool failed: network')
  })
})

describe('guarded fetch', () => {
  it('refuses http, private hosts, credentials in the URL and redirects', async () => {
    await expect(guardedFetch('http://example.com', {})).rejects.toBeInstanceOf(BlockedUrlError)
    await expect(guardedFetch('https://user:pw@example.com', {})).rejects.toBeInstanceOf(BlockedUrlError)
    await expect(guardedFetch('https://127.0.0.1/x', {})).rejects.toBeInstanceOf(BlockedUrlError)
    await expect(guardedFetch('https://10.0.0.5/x', {})).rejects.toBeInstanceOf(BlockedUrlError)
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/' } }))
    await expect(guardedFetch('https://example.com', {}, { fetch: f, check: publicCheck })).rejects.toThrow(/redirect/)
    expect(f.mock.calls[0]![1].redirect).toBe('manual')
  })
  it('caps the response size', async () => {
    const big = new Response('x'.repeat(600 * 1024))
    await expect(guardedFetch('https://example.com', {}, { fetch: vi.fn().mockResolvedValue(big), check: publicCheck })).rejects.toThrow(/too large/)
  })
})

describe('MCP client', () => {
  it('parses JSON and SSE answers and finds the matching id', () => {
    expect(parseRpcResponse('application/json', '{"jsonrpc":"2.0","id":3,"result":{"ok":1}}', 3)).toMatchObject({ result: { ok: 1 } })
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[]}}\n\n'
    expect(parseRpcResponse('text/event-stream', sse, 2)).toMatchObject({ id: 2, result: { tools: [] } })
    expect(parseRpcResponse('application/json', '{"jsonrpc":"2.0","id":9,"result":{}}', 2)).toBeNull()
    expect(() => parseRpcResponse('application/json', '<html>', 1)).toThrow(/not JSON/)
  })

  it('handshakes with a session, lists tools with paging, calls a tool with the bearer token', async () => {
    const seen: { body: any; headers: Record<string, string> }[] = []
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      seen.push({ body, headers: init.headers as Record<string, string> })
      if (body.method === 'initialize') return json(200, { jsonrpc: '2.0', id: body.id, result: { serverInfo: { name: 'Bookings' }, protocolVersion: '2025-06-18' } }, { 'mcp-session-id': 'S1' })
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
      if (body.method === 'tools/list' && !body.params.cursor) return json(200, { jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'find_slot', annotations: { readOnlyHint: true } }], nextCursor: 'p2' } })
      if (body.method === 'tools/list') return new Response(`data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'book' }] } })}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      if (body.method === 'tools/call') return json(200, { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'Booked for Tue' }] } })
      return json(200, { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'nope' } })
    })
    const conn = { url: 'https://mcp.example.com/mcp', token: 'tok', fetch: f as unknown as typeof fetch, check: publicCheck }
    const d = await discoverMcpTools(conn)
    expect(d).toEqual({ serverName: 'Bookings', tools: [{ name: 'find_slot', annotations: { readOnlyHint: true } }, { name: 'book' }] })
    expect(seen[0]!.headers.Authorization).toBe('Bearer tok')
    expect(seen[1]!.headers['Mcp-Session-Id']).toBe('S1')
    const c = new McpClient(conn)
    await c.initialize()
    expect(await c.callTool('book', { day: 'Tue' })).toEqual({ text: 'Booked for Tue', isError: false })
    await expect(c.request('missing')).rejects.toThrow('nope')
  })

  it('reports a refused token clearly', async () => {
    const f = vi.fn(async () => new Response('', { status: 401 }))
    await expect(discoverMcpTools({ url: 'https://mcp.example.com', fetch: f as unknown as typeof fetch, check: publicCheck })).rejects.toThrow(/refused the token/)
  })
})

describe('HTTP action', () => {
  it('fills {{fields}} in the path, puts the rest in the query (GET) or a JSON body (POST)', () => {
    expect(buildRequest({ method: 'GET', url: 'https://api.x.com/orders/{{order_id}}' }, { order_id: 'A/1', verbose: true })).toEqual({ url: 'https://api.x.com/orders/A%2F1?verbose=true', body: null })
    expect(buildRequest({ method: 'POST', url: 'https://api.x.com/leads' }, { name: 'Ada', budget: 5 })).toEqual({ url: 'https://api.x.com/leads', body: '{"name":"Ada","budget":5}' })
  })
  it('sends secret headers, returns status + body, marks 4xx/5xx as errors', async () => {
    const f = vi.fn(async () => new Response('{"ok":false}', { status: 422 }))
    const r = await runHttpAction({ method: 'POST', url: 'https://api.x.com/leads' }, { Authorization: 'Bearer s' }, { name: 'Ada' }, { fetch: f as unknown as typeof fetch, check: publicCheck })
    expect(r).toEqual({ text: 'HTTP 422\n{"ok":false}', isError: true })
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: 'Bearer s', 'Content-Type': 'application/json' })
  })
})

describe('Paystack tools (business key)', () => {
  it('creates a payment page link in subunits and checks a payment', async () => {
    const f = vi.fn(async (u: string) => (String(u).endsWith('/page')
      ? json(200, { status: true, data: { slug: 'abc123' } })
      : json(200, { status: true, data: { status: 'success', amount: 1500000, currency: 'NGN', paid_at: '2026-11-27' } })))
    const link = await runPaystackTool('sk_test_x', { currency: 'NGN', business_name: 'Kena' }, 'create_payment_link', { amount: 15000, description: 'Starter plan' }, f as unknown as typeof fetch)
    expect(JSON.parse(link.text)).toEqual({ link: 'https://paystack.com/pay/abc123', amount: 15000, currency: 'NGN', description: 'Starter plan' })
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ amount: 1500000, name: 'Kena: Starter plan' })
    const paid = await runPaystackTool('sk_test_x', {}, 'check_payment', { reference: 'T1234' }, f as unknown as typeof fetch)
    expect(JSON.parse(paid.text)).toMatchObject({ status: 'success', amount: 15000 })
    expect((await runPaystackTool('k', {}, 'create_payment_link', { amount: -1 }, f as unknown as typeof fetch)).isError).toBe(true)
    expect((await runPaystackTool('k', {}, 'check_payment', { reference: '../x' }, f as unknown as typeof fetch)).isError).toBe(true)
  })
})

describe('registry helpers', () => {
  it('redacts secret-looking keys and long strings', () => {
    expect(redact({ name: 'Ada', password: 'p', nested: { api_key: 'k', note: 'x'.repeat(600) } })).toEqual({ name: 'Ada', password: '[redacted]', nested: { api_key: '[redacted]', note: `${'x'.repeat(500)}…` } })
  })
  it('makes unique, valid model-facing tool names', () => {
    const taken = new Set<string>()
    expect(toolSpecName('Google Calendar', 'create_event', taken)).toBe('google_calendar__create_event')
    expect(toolSpecName('Google Calendar', 'create_event', taken)).toBe('google_calendar__create_event_2')
    expect(toolSpecName('ÉÉÉ', 'weird name!', taken)).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  })
})

describe('loadToolRuntime gates', () => {
  it('returns no tools without the plan feature', async () => {
    const { loadToolRuntime } = await import('./registry')
    const db = { from: (t: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: t === 'account_subscriptions' ? { plan_id: 'free', status: 'active', limit_overrides: {}, feature_overrides: {} } : { name: 'Free', limits: {}, features: { ai_tools: false } } }) }) }) }) } as unknown as SupabaseClient
    expect(await loadToolRuntime(db, { accountId: 'a', conversationId: null, agentId: null, mode: 'draft' })).toBeNull()
  })
})
