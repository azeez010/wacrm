import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: (s: string) => `enc(${s})`, decrypt: (s: string) => s.replace(/^enc\((.*)\)$/, '$1') }))
import {
  IntegrationInputError,
  createSchema,
  fieldsToSchema,
  mcpToolRows,
  prepareCreate,
  prepareUpdate,
  schemaToFields,
  sealSecrets,
} from './manage'

const publicCheck = async (u: string) => new URL(u)
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

function mcpServer(tools: unknown[]) {
  return vi.fn(async (_u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { id?: number; method: string }
    if (body.method === 'initialize') return json(200, { jsonrpc: '2.0', id: body.id, result: { serverInfo: { name: 'Bookings' } } }, { 'mcp-session-id': 'S' })
    if (body.method === 'tools/list') return json(200, { jsonrpc: '2.0', id: body.id, result: { tools } })
    return new Response(null, { status: 202 })
  }) as unknown as typeof fetch
}

describe('integration helpers', () => {
  it('turns declared fields into a JSON schema and back', () => {
    const fields = [
      { name: 'date', type: 'string' as const, description: 'YYYY-MM-DD', required: true },
      { name: 'guests', type: 'integer' as const, description: '', required: false },
    ]
    const schema = fieldsToSchema(fields)
    expect(schema).toEqual({ type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, guests: { type: 'integer' } }, required: ['date'] })
    expect(schemaToFields(schema)).toEqual(fields)
  })

  it('treats MCP tools as actions unless the server marks them read-only', () => {
    const rows = mcpToolRows([
      { name: 'list_slots', annotations: { readOnlyHint: true } },
      { name: 'book_slot', description: 'Book' },
      { name: 'bad name!' },
    ])
    expect(rows.map((r) => [r.name, r.kind])).toEqual([['list_slots', 'read'], ['book_slot', 'action']])
  })

  it('encrypts secrets and only exposes hints', () => {
    const s = sealSecrets({ token: 'abcd1234wxyz', empty: '' })
    expect(s.secret_hints).toEqual({ token: '••••wxyz' })
    expect(s.secrets).toContain('abcd1234wxyz')
    expect(sealSecrets({}).secrets).toBeNull()
  })

  it('validates the Paystack key format', () => {
    expect(createSchema.safeParse({ kind: 'paystack', name: 'P', secret_key: 'pk_live_xxx' }).success).toBe(false)
    expect(createSchema.safeParse({ kind: 'paystack', name: 'P', secret_key: 'sk_test_abcdefghijkl' }).success).toBe(true)
  })
})

describe('prepareCreate', () => {
  it('connects to an MCP server and lists its tools', async () => {
    const f = mcpServer([{ name: 'list_slots', annotations: { readOnlyHint: true } }, { name: 'book_slot' }])
    const out = await prepareCreate({ kind: 'mcp', name: 'Bookings', url: 'https://mcp.example.com/mcp', token: 'secret-token' }, { fetch: f, check: publicCheck })
    expect(out.row.config).toMatchObject({ url: 'https://mcp.example.com/mcp', server_name: 'Bookings' })
    expect(out.row.secret_hints).toEqual({ token: '••••oken' })
    expect(out.tools).toHaveLength(2)
    const auth = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].headers as Record<string, string>
    expect(auth.Authorization).toBe('Bearer secret-token')
  })

  it('reports an MCP server that refuses the token as an input error', async () => {
    const f = vi.fn(async () => new Response('no', { status: 401 })) as unknown as typeof fetch
    await expect(prepareCreate({ kind: 'mcp', name: 'X', url: 'https://mcp.example.com', token: 't' }, { fetch: f, check: publicCheck })).rejects.toBeInstanceOf(IntegrationInputError)
  })

  it('rejects a private URL for an HTTP action', async () => {
    const check = async () => { throw new Error('That address is private') }
    await expect(
      prepareCreate({ kind: 'http', name: 'CRM', headers: [], tools: [{ name: 'add', description: 'Add a lead', method: 'POST', url: 'https://10.0.0.1/x', fields: [], kind: 'action' }] }, { check }),
    ).rejects.toThrow(/add: That address is private/)
  })

  it('stores HTTP header values as secrets and the actions as tools', async () => {
    const out = await prepareCreate(
      { kind: 'http', name: 'CRM', headers: [{ name: 'X-Api-Key', value: 'k-123456' }], tools: [{ name: 'add_lead', description: 'Add a lead', method: 'POST', url: 'https://api.crm.com/leads', fields: [{ name: 'name', type: 'string', description: '', required: true }], kind: 'action' }] },
      { check: publicCheck },
    )
    expect(out.row.config).toEqual({ header_names: ['X-Api-Key'] })
    expect(out.row.secret_hints).toEqual({ 'header:X-Api-Key': '••••3456' })
    expect(out.tools[0]).toMatchObject({ name: 'add_lead', kind: 'action', config: { method: 'POST', url: 'https://api.crm.com/leads' } })
  })

  it('checks the Paystack key and adds the built-in tools', async () => {
    const f = vi.fn(async () => json(200, { status: true, data: [] })) as unknown as typeof fetch
    const out = await prepareCreate({ kind: 'paystack', name: 'Paystack', secret_key: 'sk_test_abcdefghijkl', currency: 'NGN' }, { fetch: f })
    expect(out.row.config).toMatchObject({ currency: 'NGN', mode: 'test' })
    expect(out.tools.map((t) => t.name)).toEqual(['create_payment_link', 'check_payment'])

    const bad = vi.fn(async () => json(401, { status: false, message: 'Invalid key' })) as unknown as typeof fetch
    await expect(prepareCreate({ kind: 'paystack', name: 'P', secret_key: 'sk_live_abcdefghijkl', currency: 'NGN' }, { fetch: bad })).rejects.toThrow(/Invalid key/)
  })
})

describe('prepareUpdate', () => {
  it('keeps a saved header value when the form leaves it blank', async () => {
    const current = { kind: 'http' as const, config: { header_names: ['X-Api-Key'] }, secrets: `enc(${JSON.stringify({ 'header:X-Api-Key': 'old-secret' })})` }
    const patch = await prepareUpdate(current, { headers: [{ name: 'X-Api-Key', value: '' }, { name: 'X-Other', value: 'new-value' }] })
    expect(patch.secret_hints).toEqual({ 'header:X-Api-Key': '••••cret', 'header:X-Other': '••••alue' })
    expect(patch.config).toEqual({ header_names: ['X-Api-Key', 'X-Other'] })
  })

  it('renames without touching secrets', async () => {
    const patch = await prepareUpdate({ kind: 'paystack', config: { currency: 'NGN' }, secrets: 'enc({})' }, { name: 'Shop payments' })
    expect(patch).toEqual({ name: 'Shop payments', config: { currency: 'NGN' } })
  })
})
