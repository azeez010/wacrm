import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

const api = vi.hoisted(() => ({
  me: vi.fn(async () => ({ data: { account: { id: 'a1' } } })),
  listContacts: vi.fn(async () => ({ data: [{ id: 'c1' }], next_cursor: null })),
  sendBroadcast: vi.fn(async () => ({ data: { id: 'b1' } })),
}))
vi.mock('./dispatch', async () => {
  const actual = await vi.importActual<typeof import('./dispatch')>('./dispatch')
  return { ...actual, createApiClient: () => api }
})

import { createWacrmMcpServer } from './server'
import { ApiCallError } from './dispatch'

async function connect(scopes: string[]) {
  const server = createWacrmMcpServer('Bearer wacrm_live_x', scopes)
  const client = new Client({ name: 'test', version: '1.0.0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), client.connect(b)])
  return client
}
const names = async (c: Client) => (await c.listTools()).tools.map((t) => t.name).sort()

describe('hosted MCP server', () => {
  it('exposes only whoami for a key with no scopes', async () => {
    expect(await names(await connect([]))).toEqual(['whoami'])
  })

  it('exposes read tools for read scopes and hides every write tool', async () => {
    const t = await names(await connect(['contacts:read', 'conversations:read', 'messages:read']))
    expect(t).toEqual(
      ['get_contact', 'get_conversation', 'list_contacts', 'list_conversations', 'list_messages', 'whoami'].sort(),
    )
  })

  it('adds write tools only with their scope', async () => {
    const t = await names(await connect(['contacts:write', 'messages:send', 'broadcasts:send']))
    expect(t).toEqual(
      ['create_contact', 'get_broadcast', 'send_broadcast', 'send_message', 'update_contact', 'whoami'].sort(),
    )
  })

  it('returns tool data as JSON text', async () => {
    const c = await connect(['contacts:read'])
    const r = await c.callTool({ name: 'list_contacts', arguments: { search: 'ann' } })
    expect(r.isError).toBeFalsy()
    expect(JSON.parse((r.content as { text: string }[])[0].text)).toEqual({
      data: [{ id: 'c1' }],
      next_cursor: null,
    })
  })

  it('refuses a broadcast without confirm=true and never calls the API', async () => {
    const c = await connect(['broadcasts:send'])
    const r = await c.callTool({
      name: 'send_broadcast',
      arguments: {
        name: 'x',
        template_name: 't',
        template_language: 'en',
        recipients: [{ to: '+15551234567' }],
        confirm: false,
      },
    })
    expect(r.isError).toBe(true)
    expect(api.sendBroadcast).not.toHaveBeenCalled()
  })

  it('turns API errors into model-readable tool errors', async () => {
    api.listContacts.mockRejectedValueOnce(new ApiCallError(403, 'forbidden', 'missing scope'))
    const c = await connect(['contacts:read'])
    const r = await c.callTool({ name: 'list_contacts', arguments: {} })
    expect(r.isError).toBe(true)
    expect((r.content as { text: string }[])[0].text).toContain('[forbidden]')
  })
})
