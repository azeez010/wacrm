/**
 * MCP tools for day-to-day operations: conversation actions, broadcast history,
 * template read/delete, bulk contact import, and API-key management.
 * Registered per request from the key's scopes; the API re-checks scopes and plan gates.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { API_SCOPES } from '@/lib/api-keys/scopes'
import type { ApiClient } from './dispatch'
import { DESTRUCTIVE, READ, WRITE, cursor, errorResult, has, limit, run } from './helpers'

export function registerOpsTools(server: McpServer, api: ApiClient, scopes: string[]) {
  if (has(scopes, 'conversations:write')) {
    server.registerTool(
      'update_conversation',
      {
        title: 'Update conversation',
        description:
          'Assign a conversation to a team member (assigned_agent_id from list_team_members, or null to unassign) and/or set its status: open, pending or closed. Closing and reopening are reversible.',
        inputSchema: {
          conversation_id: z.string(),
          status: z.enum(['open', 'pending', 'closed']).optional(),
          assigned_agent_id: z.string().nullable().optional().describe('User id from list_team_members, or null to unassign.'),
        },
        annotations: { ...WRITE, title: 'Update conversation' },
      },
      run(async ({ conversation_id, ...body }) => api.updateConversation(conversation_id, body)),
    )
  }

  if (has(scopes, 'broadcasts:send')) {
    server.registerTool(
      'list_broadcasts',
      {
        title: 'List broadcasts',
        description: 'Past and running broadcasts, newest first, with delivery counts. Paginated.',
        inputSchema: { limit, cursor },
        annotations: { ...READ, title: 'List broadcasts' },
      },
      run(async ({ limit: l, cursor: c }) => api.listBroadcasts({ limit: l, cursor: c })),
    )
  }

  if (has(scopes, 'templates:read')) {
    server.registerTool(
      'get_template',
      {
        title: 'Get template',
        description: 'One message template with its full body, buttons, approval status and any rejection reason.',
        inputSchema: { template_id: z.string() },
        annotations: { ...READ, title: 'Get template' },
      },
      run(async ({ template_id }) => api.getTemplate(template_id)),
    )
  }
  if (has(scopes, 'templates:write')) {
    server.registerTool(
      'delete_template',
      {
        title: 'Delete template',
        description: 'Delete a template on Meta and in OgaDesk. Automations or broadcasts that use it will stop working. You MUST set confirm=true, only after the user agreed to deleting this exact template.',
        inputSchema: { template_id: z.string(), confirm: z.boolean() },
        annotations: { ...DESTRUCTIVE, title: 'Delete template' },
      },
      run(async ({ template_id, confirm }) =>
        confirm === true ? api.deleteTemplate(template_id) : errorResult('Refusing to delete: confirm must be true. Ask the user to confirm deleting this template first.'),
      ),
    )
  }

  if (has(scopes, 'contacts:write')) {
    server.registerTool(
      'import_contacts',
      {
        title: 'Import contacts',
        description:
          'Add many contacts at once from CSV text or a list (max 500 per call; split bigger files). CSV columns: phone (required, international format with +), name, email, company, tags (separate several with ; or |); any other column becomes a custom field with that key (see list_custom_fields). ' +
          'Existing contacts keep their name/email/company; only tags and custom fields are added. ALWAYS run once with dry_run=true first, show the user the summary (and any failed rows), then run again for real. Only import people who agreed to be contacted.',
        inputSchema: {
          csv: z.string().optional().describe('The CSV text, header row first. Use this OR contacts.'),
          contacts: z
            .array(z.object({ phone: z.string(), name: z.string().optional(), email: z.string().optional(), company: z.string().optional(), tags: z.array(z.string()).optional(), custom_fields: z.record(z.string(), z.unknown()).optional() }))
            .optional()
            .describe('A list instead of CSV.'),
          tags: z.array(z.string()).optional().describe('Tag names added to every imported contact (e.g. the campaign).'),
          dry_run: z.boolean().optional().describe('true = check only, change nothing.'),
        },
        annotations: { ...WRITE, title: 'Import contacts' },
      },
      run(async (a) => api.importContacts(a)),
    )
  }

  if (has(scopes, 'keys:manage')) {
    server.registerTool(
      'list_api_keys',
      {
        title: 'List API keys',
        description: 'The account’s API keys: name, access scopes, last used, expiry and whether revoked. Never shows the secret.',
        inputSchema: {},
        annotations: { ...READ, title: 'List API keys' },
      },
      run(async () => api.listApiKeys()),
    )
    server.registerTool(
      'create_api_key',
      {
        title: 'Create API key',
        description:
          'Create an API key for an app. It can only have scopes THIS key already has, and never keys:manage. Choose the fewest scopes the app needs. The secret is returned ONCE: give it to the user to store as an environment variable, and do not repeat it elsewhere. You MUST set confirm=true, only after the user approved the name and scopes.',
        inputSchema: {
          name: z.string().describe('What the key is for, e.g. "Checkout app OTP".'),
          scopes: z.array(z.enum(API_SCOPES)).min(1),
          expires_in_days: z.number().int().min(1).max(365).optional(),
          confirm: z.boolean(),
        },
        annotations: { ...WRITE, title: 'Create API key' },
      },
      run(async ({ confirm, ...body }) =>
        confirm === true ? api.createApiKey(body) : errorResult('Refusing to create the key: confirm must be true. Show the user the name and scopes first.'),
      ),
    )
    server.registerTool(
      'revoke_api_key',
      {
        title: 'Revoke API key',
        description: 'Turn a key off immediately; anything using it stops working. A key cannot revoke itself. You MUST set confirm=true after the user agreed.',
        inputSchema: { key_id: z.string(), confirm: z.boolean() },
        annotations: { ...DESTRUCTIVE, title: 'Revoke API key' },
      },
      run(async ({ key_id, confirm }) =>
        confirm === true ? api.revokeApiKey(key_id) : errorResult('Refusing to revoke: confirm must be true. Ask the user first.'),
      ),
    )
  }
}
