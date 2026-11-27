import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { API_SCOPES } from '@/lib/api-keys/scopes'
import { PLAYBOOKS } from './playbooks'

vi.mock('./dispatch', async () => {
  const actual = await vi.importActual<typeof import('./dispatch')>('./dispatch')
  return { ...actual, createApiClient: () => ({}) }
})
import { createWacrmMcpServer } from './server'

/** Every REST route + method and the MCP tool that covers it. 'none' = deliberately not an MCP tool. */
const ROUTE_TOOLS: Record<string, string> = {
  'GET /automations': 'list_automations',
  'POST /automations': 'create_automation',
  'GET /automations/[id]': 'get_automation',
  'PATCH /automations/[id]': 'update_automation',
  'DELETE /automations/[id]': 'delete_automation',
  'POST /automations/validate': 'validate_automation',
  'GET /broadcasts': 'list_broadcasts',
  'POST /broadcasts': 'send_broadcast',
  'GET /broadcasts/[id]': 'get_broadcast',
  'GET /contacts': 'list_contacts',
  'POST /contacts': 'create_contact',
  'GET /contacts/[id]': 'get_contact',
  'PATCH /contacts/[id]': 'update_contact',
  'POST /contacts/filter': 'filter_contacts',
  'POST /contacts/import': 'import_contacts',
  'GET /api-keys': 'list_api_keys',
  'POST /api-keys': 'create_api_key',
  'DELETE /api-keys/[id]': 'revoke_api_key',
  'GET /conversations': 'list_conversations',
  'GET /conversations/[id]': 'get_conversation',
  'PATCH /conversations/[id]': 'update_conversation',
  'GET /conversations/[id]/messages': 'list_messages',
  'GET /custom-fields': 'list_custom_fields',
  'POST /custom-fields': 'create_custom_field',
  'PATCH /custom-fields/[id]': 'update_custom_field',
  'DELETE /custom-fields/[id]': 'delete_custom_field',
  'GET /deals': 'list_deals',
  'POST /deals': 'create_deal',
  'GET /deals/[id]': 'get_deal',
  'PATCH /deals/[id]': 'update_deal',
  'GET /flows': 'list_flows',
  'POST /flows': 'create_flow',
  'GET /flows/[id]': 'get_flow',
  'PUT /flows/[id]': 'update_flow',
  'DELETE /flows/[id]': 'delete_flow',
  'POST /flows/[id]/status': 'set_flow_status',
  'POST /flows/validate': 'validate_flow',
  'GET /forms': 'list_forms',
  'POST /forms': 'create_form',
  'GET /forms/[id]': 'get_form',
  'PATCH /forms/[id]': 'update_form',
  'DELETE /forms/[id]': 'archive_form',
  'GET /forms/[id]/submissions': 'list_form_submissions',
  'POST /forms/[id]/submissions': 'submit_form_lead',
  'POST /forms/[id]/submissions/release': 'release_held_leads',
  'GET /forms/[id]/export': 'export_form',
  'POST /forms/import': 'import_form',
  'GET /me': 'whoami',
  'POST /messages': 'send_message',
  'GET /messages/[id]': 'get_message',
  'GET /openapi.json': 'none', // the API spec itself
  'GET /pipelines': 'list_pipelines',
  'POST /pipelines': 'create_pipeline',
  'GET /pipelines/[id]': 'get_pipeline',
  'PATCH /pipelines/[id]': 'update_pipeline',
  'DELETE /pipelines/[id]': 'delete_pipeline',
  'GET /segments': 'list_segments',
  'POST /segments': 'create_segment',
  'GET /segments/[id]': 'get_segment',
  'PATCH /segments/[id]': 'update_segment',
  'DELETE /segments/[id]': 'delete_segment',
  'GET /segments/[id]/contacts': 'list_segment_contacts',
  'GET /tables': 'list_tables',
  'POST /tables': 'create_table',
  'GET /tables/[id]': 'get_table',
  'PATCH /tables/[id]': 'update_table',
  'DELETE /tables/[id]': 'delete_table',
  'GET /tables/[id]/records': 'list_table_rows',
  'POST /tables/[id]/records': 'create_table_row',
  'PATCH /tables/[id]/records/[recordId]': 'update_table_row',
  'DELETE /tables/[id]/records/[recordId]': 'delete_table_row',
  'GET /tags': 'list_tags',
  'POST /tags': 'create_tag',
  'GET /team': 'list_team_members',
  'PATCH /team/[id]': 'update_member_role',
  'DELETE /team/[id]': 'remove_member',
  'GET /workspace': 'get_workspace',
  'PATCH /workspace': 'update_workspace',
  'GET /invitations': 'list_invitations',
  'POST /invitations': 'create_invitation',
  'DELETE /invitations/[id]': 'revoke_invitation',
  'GET /ai/agent-templates': 'list_ai_agent_templates',
  'GET /ai/agents': 'list_ai_agents',
  'POST /ai/agents': 'create_ai_agent',
  'GET /ai/agents/[id]': 'get_ai_agent',
  'PATCH /ai/agents/[id]': 'update_ai_agent',
  'DELETE /ai/agents/[id]': 'delete_ai_agent',
  'PUT /ai/agents/[id]/knowledge': 'link_agent_knowledge',
  'GET /ai/knowledge/sources': 'list_knowledge_sources',
  'POST /ai/knowledge/sources': 'create_knowledge_source',
  'DELETE /ai/knowledge/sources/[id]': 'delete_knowledge_source',
  'POST /ai/knowledge/sources/[id]/sync': 'sync_knowledge_source',
  'POST /ai/knowledge/search': 'search_knowledge',
  'GET /ai/integrations': 'list_integrations',
  'GET /ai/tool-calls': 'list_ai_tool_calls',
  'GET /ai/usage': 'get_ai_usage',
  'PUT /ai/conversations/[id]/agent': 'set_conversation_agent',
  'GET /workspaces': 'list_workspaces',
  'POST /workspaces': 'create_workspace',
  'GET /templates': 'list_templates',
  'POST /templates': 'create_template',
  'GET /templates/[id]': 'get_template',
  'DELETE /templates/[id]': 'delete_template',
  'GET /usage': 'get_usage',
  'GET /plan': 'get_plan',
  'GET /plans': 'list_plans',
  'POST /verifications': 'send_verification',
  'GET /verifications/[id]': 'get_verification',
  'POST /verifications/[id]/check': 'check_verification',
  'GET /webhooks': 'list_webhooks',
  'POST /webhooks': 'create_webhook',
  'GET /webhooks/[id]': 'get_webhook',
  'PATCH /webhooks/[id]': 'update_webhook',
  'DELETE /webhooks/[id]': 'delete_webhook',
}

function routeMethods(): string[] {
  const root = join(process.cwd(), 'src', 'app', 'api', 'v1')
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name === 'route.ts') {
        const route = dir.slice(root.length) || '/'
        for (const m of readFileSync(p, 'utf8').matchAll(/export (?:async function|const) (GET|POST|PATCH|PUT|DELETE)\b/g)) out.push(`${m[1]} ${route}`)
      }
    }
  }
  walk(root)
  return out.sort()
}

async function allTools(): Promise<Set<string>> {
  const server = createWacrmMcpServer('Bearer x', [...API_SCOPES], { hasWhatsAppConnection: true })
  const client = new Client({ name: 't', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), client.connect(b)])
  return new Set((await client.listTools()).tools.map((t) => t.name))
}

describe('MCP covers the whole REST API', () => {
  it('every REST route has an entry (a tool, or deliberately none), so nothing is forgotten', () => {
    const missing = routeMethods().filter((r) => !(r in ROUTE_TOOLS))
    expect(missing, 'add these routes to ROUTE_TOOLS (and an MCP tool, or "none")').toEqual([])
  })

  it('every mapped tool exists, and no mapping points at a deleted route', async () => {
    const tools = await allTools()
    const unknown = Object.values(ROUTE_TOOLS).filter((t) => t !== 'none' && !tools.has(t))
    expect(unknown).toEqual([])
    const routes = new Set(routeMethods())
    expect(Object.keys(ROUTE_TOOLS).filter((r) => !routes.has(r))).toEqual([])
  })

  it('every tool a playbook names exists', async () => {
    const tools = await allTools()
    const text = JSON.stringify(PLAYBOOKS)
    const named = new Set([...text.matchAll(/\b((?:list|get|create|update|delete|send|set|submit|validate|check|filter|archive)_[a-z_]+)\b/g)].map((m) => m[1]))
    // names that appear as prose/event words rather than tools
    const prose = new Set(['send_template', 'send_message', 'create_tag'])
    const missing = [...named].filter((n) => !tools.has(n) && !prose.has(n) && !/^(update_contact_field|send_buttons|send_list)$/.test(n))
    expect(missing).toEqual([])
  })
})
