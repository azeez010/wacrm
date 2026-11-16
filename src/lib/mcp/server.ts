/**
 * Hosted MCP server definition. Tools are registered PER REQUEST from
 * the calling API key's scopes, so a read-only key never even sees a
 * tool that sends a message — and the API re-checks scopes anyway.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { ApiCallError, createApiClient, type ApiClient, type ApiResult } from './dispatch'

const text = (payload: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
})
const errorResult = (message: string): CallToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
})

function run<A>(fn: (args: A) => Promise<ApiResult | CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      const r = await fn(args)
      if ('content' in r) return r
      return text(r.next_cursor !== undefined ? { data: r.data, next_cursor: r.next_cursor } : { data: r.data })
    } catch (err) {
      if (err instanceof ApiCallError) return errorResult(`wacrm API error [${err.code}]: ${err.message}`)
      return errorResult(`Unexpected error: ${(err as Error).message}`)
    }
  }
}

const READ = { readOnlyHint: true, openWorldHint: false } as const
const WRITE = { readOnlyHint: false, openWorldHint: true } as const
const limit = z.number().int().min(1).max(100).optional().describe('Page size, 1–100 (default 50).')
const cursor = z.string().optional().describe('Opaque pagination cursor from a previous response.')

const has = (scopes: string[], s: string) => scopes.includes(s)

export function createWacrmMcpServer(authorization: string, scopes: string[]) {
  const api: ApiClient = createApiClient(authorization)
  const server = new McpServer({ name: 'wacrm', version: '1.0.0' })

  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description:
        'Show which wacrm account this connection is bound to and which scopes it carries. Call first to see what is possible.',
      inputSchema: {},
      annotations: { ...READ, title: 'Who am I' },
    },
    run(async () => api.me()),
  )

  if (has(scopes, 'contacts:read')) {
    server.registerTool(
      'list_contacts',
      {
        title: 'List contacts',
        description:
          'List contacts, newest first. Filter by free-text search (name or phone) or tag id. Paginated: pass next_cursor to get the next page.',
        inputSchema: {
          search: z.string().optional().describe('Free-text search over name or phone number.'),
          tag: z.string().optional().describe('Tag id (UUID) to filter by.'),
          limit,
          cursor,
        },
        annotations: { ...READ, title: 'List contacts' },
      },
      run(async (a) => api.listContacts(a)),
    )
    server.registerTool(
      'get_contact',
      {
        title: 'Get contact',
        description: 'Read one contact by id.',
        inputSchema: { id: z.string().describe('Contact id.') },
        annotations: { ...READ, title: 'Get contact' },
      },
      run(async ({ id }) => api.getContact(id)),
    )
  }

  if (has(scopes, 'conversations:read')) {
    server.registerTool(
      'list_conversations',
      {
        title: 'List conversations',
        description: 'List conversations, newest first. Filter by status (open/pending/closed) or contact id. Paginated.',
        inputSchema: {
          status: z.enum(['open', 'pending', 'closed']).optional(),
          contact_id: z.string().optional().describe('Only conversations for this contact.'),
          limit,
          cursor,
        },
        annotations: { ...READ, title: 'List conversations' },
      },
      run(async (a) => api.listConversations(a)),
    )
    server.registerTool(
      'get_conversation',
      {
        title: 'Get conversation',
        description: 'Read one conversation by id, including its contact and tags.',
        inputSchema: { id: z.string().describe('Conversation id.') },
        annotations: { ...READ, title: 'Get conversation' },
      },
      run(async ({ id }) => api.getConversation(id)),
    )
  }

  if (has(scopes, 'messages:read')) {
    server.registerTool(
      'list_messages',
      {
        title: 'List messages',
        description:
          'List messages in a conversation, newest first, with direction (inbound/outbound), delivery status and content. Paginated.',
        inputSchema: { conversation_id: z.string(), limit, cursor },
        annotations: { ...READ, title: 'List messages' },
      },
      run(async ({ conversation_id, limit: l, cursor: c }) => api.listMessages(conversation_id, { limit: l, cursor: c })),
    )
  }

  if (has(scopes, 'contacts:write')) {
    server.registerTool(
      'create_contact',
      {
        title: 'Create contact',
        description:
          'Create a contact by phone number (E.164, e.g. +14155550123). Find-or-create: an existing contact keeps its name/email/company, and any tags passed are added, never removed.',
        inputSchema: {
          phone: z.string().describe('Phone number in E.164 format.'),
          name: z.string().optional(),
          email: z.string().email().optional(),
          company: z.string().optional(),
          tags: z.array(z.string()).optional().describe('Tag names; created if missing.'),
        },
        annotations: { ...WRITE, title: 'Create contact' },
      },
      run(async (a) => api.createContact(a)),
    )
    server.registerTool(
      'update_contact',
      {
        title: 'Update contact',
        description: 'Update a contact. Only the fields you pass change. Passing tags REPLACES the contact’s tags.',
        inputSchema: {
          id: z.string().describe('Contact id.'),
          name: z.string().optional(),
          email: z.string().email().optional(),
          company: z.string().optional(),
          tags: z.array(z.string()).optional(),
        },
        annotations: { ...WRITE, title: 'Update contact' },
      },
      run(async ({ id, ...body }) => api.updateContact(id, body)),
    )
  }

  if (has(scopes, 'messages:send')) {
    server.registerTool(
      'send_message',
      {
        title: 'Send WhatsApp message',
        description:
          'Send a WhatsApp message to a phone number (E.164). Contact and conversation are found-or-created. "text" only works inside the 24-hour customer-service window; use "template" (an approved template) to open a conversation. Media types need media_url. This sends a REAL message to a REAL person — confirm recipient and content with the user first.',
        inputSchema: {
          to: z.string().describe('Recipient phone number in E.164 format.'),
          type: z.enum(['text', 'template', 'image', 'video', 'document', 'audio']).default('text'),
          text: z.string().optional().describe('Body for "text", or caption for media.'),
          media_url: z.string().url().optional(),
          filename: z.string().optional().describe('File name for a "document".'),
          template: z
            .object({
              name: z.string().describe('Approved template name.'),
              language: z.string().describe('Language code, e.g. "en_US".'),
              params: z.array(z.string()).optional().describe('Positional body variables.'),
            })
            .optional(),
          reply_to_message_id: z.string().optional(),
        },
        annotations: { ...WRITE, title: 'Send WhatsApp message' },
      },
      run(async (a) => api.sendMessage(a)),
    )
  }

  if (has(scopes, 'broadcasts:send')) {
    server.registerTool(
      'send_broadcast',
      {
        title: 'Send broadcast',
        description:
          'Launch a template broadcast to up to 1000 recipients — a mass, irreversible send. You MUST set confirm=true, and should show the full recipient list and template to the user for approval first. Returns quickly; poll get_broadcast for progress.',
        inputSchema: {
          name: z.string().describe('Campaign name.'),
          template_name: z.string(),
          template_language: z.string(),
          recipients: z
            .array(z.object({ to: z.string(), params: z.array(z.string()).optional() }))
            .min(1)
            .max(1000),
          confirm: z.boolean().describe('Must be true to actually send.'),
        },
        annotations: { ...WRITE, destructiveHint: true, title: 'Send broadcast' },
      },
      run(async ({ confirm, ...body }) => {
        if (confirm !== true) {
          return errorResult(
            `Refusing to send: confirm must be true. This would message ${body.recipients.length} recipient(s). ` +
              'Confirm the list and template with the user, then call again with confirm=true.',
          )
        }
        return api.sendBroadcast(body)
      }),
    )
    server.registerTool(
      'get_broadcast',
      {
        title: 'Get broadcast status',
        description: 'Read a broadcast: status, total recipients, and sent/delivered/read/replied/failed counts.',
        inputSchema: { id: z.string().describe('Broadcast id.') },
        annotations: { ...READ, title: 'Get broadcast status' },
      },
      run(async ({ id }) => api.getBroadcast(id)),
    )
  }

  return server
}
