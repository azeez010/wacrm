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

async function connect(scopes: string[], opts: { hasWhatsAppConnection?: boolean } = {}) {
  const server = createWacrmMcpServer('Bearer wacrm_live_x', scopes, opts)
  const client = new Client({ name: 'test', version: '1.0.0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), client.connect(b)])
  return client
}
// Guidance tools that every key gets (no scope needed); tested on their own below.
const ALWAYS = new Set(['get_usage', 'get_playbook'])
const names = async (c: Client) => (await c.listTools()).tools.map((t) => t.name).filter((n) => !ALWAYS.has(n)).sort()

describe('hosted MCP server', () => {
  it('exposes only whoami for a key with no scopes', async () => {
    expect(await names(await connect([]))).toEqual(['whoami'])
  })

  it('exposes read tools for read scopes and hides every write tool', async () => {
    const t = await names(await connect(['contacts:read', 'conversations:read', 'messages:read']))
    expect(t).toEqual(
      ['filter_contacts', 'get_contact', 'get_conversation', 'get_message', 'list_contacts', 'list_conversations', 'list_messages', 'list_tags', 'whoami'].sort(),
    )
  })

  it('exposes custom field, table and segment tools only with their scopes', async () => {
    const read = await names(await connect(['fields:read', 'tables:read', 'segments:read']))
    expect(read).toEqual(
      [
        'get_custom_data_reference',
        'get_segment',
        'get_table',
        'list_custom_fields',
        'list_segment_contacts',
        'list_segments',
        'list_table_rows',
        'list_tables',
        'whoami',
      ].sort(),
    )
    const write = await names(await connect(['fields:write', 'tables:write', 'segments:write']))
    expect(write).toEqual(
      [
        'create_custom_field',
        'create_segment',
        'create_table',
        'create_table_row',
        'delete_custom_field',
        'delete_segment',
        'delete_table',
        'delete_table_row',
        'get_custom_data_reference',
        'update_custom_field',
        'update_segment',
        'update_table',
        'update_table_row',
        'whoami',
      ].sort(),
    )
    // A contacts-only key never sees the schema tools.
    expect(await names(await connect(['contacts:read']))).not.toContain('create_custom_field')
  })

  it('adds write tools only with their scope', async () => {
    const t = await names(await connect(['contacts:write', 'messages:send', 'broadcasts:send']))
    expect(t).toEqual(
      ['create_contact', 'create_tag', 'get_broadcast', 'import_contacts', 'list_broadcasts', 'list_tags', 'send_broadcast', 'send_message', 'update_contact', 'whoami'].sort(),
    )
  })

  it('offers create_template only with the scope AND a WhatsApp connection', async () => {
    const scopes = ['templates:read', 'templates:write']
    expect(await names(await connect(scopes, { hasWhatsAppConnection: true }))).toEqual(
      ['create_template', 'delete_template', 'get_template', 'list_templates', 'whoami'].sort(),
    )
    // Scope but no connection → can list, read and delete, cannot create.
    expect(await names(await connect(scopes, { hasWhatsAppConnection: false }))).toEqual(
      ['delete_template', 'get_template', 'list_templates', 'whoami'].sort(),
    )
    // Connection but no write scope → cannot create.
    expect(await names(await connect(['templates:read'], { hasWhatsAppConnection: true }))).toEqual(
      ['get_template', 'list_templates', 'whoami'].sort(),
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

  describe('campaign-builder tools', () => {
    it('offers automation tools only with automations scopes (read vs write)', async () => {
      const read = await names(await connect(['automations:read']))
      expect(read).toEqual(
        ['get_automation', 'get_automation_reference', 'list_automations', 'list_tags', 'list_team_members', 'validate_automation', 'whoami'].sort(),
      )
      const write = await names(await connect(['automations:read', 'automations:write']))
      for (const t of ['create_automation', 'update_automation', 'delete_automation', 'create_tag']) {
        expect(write).toContain(t)
      }
      expect(read).not.toContain('create_automation')
    })

    it('offers flow and pipeline tools only with their scopes', async () => {
      const flows = await names(await connect(['flows:read', 'flows:write']))
      for (const t of ['get_flow_reference', 'create_flow', 'update_flow', 'set_flow_status', 'delete_flow', 'validate_flow']) {
        expect(flows).toContain(t)
      }
      expect(flows).not.toContain('create_pipeline')
      const pipes = await names(await connect(['pipelines:read', 'pipelines:write']))
      for (const t of ['list_pipelines', 'list_deals', 'create_pipeline', 'update_pipeline', 'delete_pipeline', 'create_deal', 'update_deal']) {
        expect(pipes).toContain(t)
      }
      expect(pipes).not.toContain('create_flow')
    })

    it('serves the authoring references without touching the API', async () => {
      const c = await connect(['automations:read', 'flows:read'])
      const a = await c.callTool({ name: 'get_automation_reference', arguments: {} })
      expect((a.content as { text: string }[])[0].text).toContain('keyword_match')
      const f = await c.callTool({ name: 'get_flow_reference', arguments: {} })
      expect((f.content as { text: string }[])[0].text).toContain('send_buttons')
    })

    it('refuses destructive deletes without confirm=true', async () => {
      const c = await connect(['flows:write', 'automations:write', 'pipelines:write'])
      for (const [name, args] of [
        ['delete_flow', { id: 'x', confirm: false }],
        ['delete_automation', { id: 'x', confirm: false }],
        ['delete_pipeline', { id: 'x', confirm: false }],
      ] as const) {
        const r = await c.callTool({ name, arguments: args })
        expect(r.isError).toBe(true)
      }
    })
  })

  it('exposes form tools by scope: read, manage (build) and write (submit) are separate', async () => {
    const read = await names(await connect(['forms:read']))
    expect(read).toEqual(['export_form', 'get_form', 'get_forms_reference', 'list_form_submissions', 'list_forms', 'whoami'].sort())
    const manage = await names(await connect(['forms:manage']))
    expect(manage).toEqual(['archive_form', 'create_form', 'import_form', 'release_held_leads', 'update_form', 'whoami'].sort())
    const submit = await names(await connect(['forms:write']))
    expect(submit).toEqual(['submit_form_lead', 'whoami'])
    // A key with read + manage sees both, and a write-only automation key sees none of them.
    expect((await names(await connect(['automations:write']))).some((n) => n.includes('form'))).toBe(false)
  })

  it('every key gets get_usage and get_playbook, plus instructions and prompts', async () => {
    const c = await connect([])
    const all = (await c.listTools()).tools.map((t) => t.name)
    expect(all).toEqual(expect.arrayContaining(['whoami', 'get_usage', 'get_playbook']))
    expect(c.getInstructions()).toContain('get_playbook')
    const prompts = (await c.listPrompts()).prompts.map((p) => p.name)
    expect(prompts).toEqual(expect.arrayContaining(['marketing_project', 'launch_lead_gen']))
    const got = await c.getPrompt({ name: 'launch_lead_gen', arguments: { goal: 'spring promo' } })
    expect(JSON.stringify(got.messages)).toContain('spring promo')
    const pb = await c.callTool({ name: 'get_playbook', arguments: { topic: 'developer_api' } })
    expect(JSON.stringify(pb)).toContain('/api/v1')
    expect(JSON.stringify(pb)).not.toContain('mcp.internal')
  })

  it('key management and conversation actions need their own scopes, and destructive ones need confirm', async () => {
    expect(await names(await connect(['contacts:read']))).not.toContain('create_api_key')
    const t = await names(await connect(['keys:manage', 'conversations:write']))
    expect(t).toEqual(['create_api_key', 'list_api_keys', 'revoke_api_key', 'update_conversation', 'whoami'].sort())
    const c = await connect(['keys:manage', 'templates:write'])
    const r1 = await c.callTool({ name: 'create_api_key', arguments: { name: 'x', scopes: ['contacts:read'], confirm: false } })
    expect(r1.isError).toBe(true)
    const r2 = await c.callTool({ name: 'delete_template', arguments: { template_id: 't', confirm: false } })
    expect(r2.isError).toBe(true)
  })
})
