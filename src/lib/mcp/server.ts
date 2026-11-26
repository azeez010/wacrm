/**
 * Hosted MCP server definition. Tools are registered PER REQUEST from
 * the calling API key's scopes, so a read-only key never even sees a
 * tool that sends a message - and the API re-checks scopes anyway.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { createApiClient, type ApiClient } from './dispatch'
import { READ, WRITE, cursor, errorResult, has, limit, run } from './helpers'
import { registerBuilderTools } from './builder-tools'
import { registerCustomTools } from './custom-tools'
import { registerFormsTools } from './forms-tools'
import { registerDevTools } from './dev-tools'
import { registerOpsTools } from './ops-tools'
import { registerGuidance } from './guidance'
import { SERVER_INSTRUCTIONS } from './playbooks'

export function createWacrmMcpServer(
  authorization: string,
  scopes: string[],
  opts: { hasWhatsAppConnection?: boolean } = {},
) {
  const api: ApiClient = createApiClient(authorization)
  const server = new McpServer({ name: 'wacrm', version: '1.0.0' }, { instructions: SERVER_INSTRUCTIONS })

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
        description: 'List conversations, newest first. Filter by status (open/pending/closed), contact id or channel (whatsapp, or web_chat for website live chat). Each conversation says its channel. Paginated.',
        inputSchema: {
          status: z.enum(['open', 'pending', 'closed']).optional(),
          contact_id: z.string().optional().describe('Only conversations for this contact.'),
          channel: z.enum(['whatsapp', 'web_chat']).optional().describe('Only conversations on this channel.'),
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
          custom_fields: z
            .record(z.string(), z.unknown())
            .optional()
            .describe('Typed custom field values keyed by field key, e.g. {"plan":"Gold","amount":15000}. null clears a value. See get_custom_data_reference.'),
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
          blocked: z
            .boolean()
            .optional()
            .describe('true blocks the contact (no message of any kind is sent to them: manual, broadcast, automation, flow, AI); false unblocks.'),
          custom_fields: z
            .record(z.string(), z.unknown())
            .optional()
            .describe('Typed custom field values keyed by field key, e.g. {"plan":"Gold","amount":15000}. null clears a value. See get_custom_data_reference.'),
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
          'Send a WhatsApp message to a phone number (E.164). Contact and conversation are found-or-created. "text" only works inside the 24-hour customer-service window; use "template" (an approved template) to open a conversation. Media types need media_url. This sends a REAL message to a REAL person, confirm recipient and content with the user first.',
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

  if (has(scopes, 'templates:read')) {
    server.registerTool(
      'list_templates',
      {
        title: 'List message templates',
        description:
          'List WhatsApp message templates with their Meta approval status (APPROVED, PENDING, REJECTED, DRAFT…). Only APPROVED templates can be sent. Filter by status. Paginated.',
        inputSchema: {
          status: z.string().optional().describe('e.g. APPROVED, PENDING, REJECTED, DRAFT.'),
          limit,
          cursor,
        },
        annotations: { ...READ, title: 'List message templates' },
      },
      run(async (a) => api.listTemplates(a)),
    )
  }

  // Creating a template submits it to Meta via a WhatsApp connection,
  // so the tool only exists when the account has one.
  if (has(scopes, 'templates:write') && opts.hasWhatsAppConnection) {
    server.registerTool(
      'create_template',
      {
        title: 'Create message template',
        description:
          'Create a WhatsApp message template and submit it to Meta for approval (usually minutes to a day; check with list_templates). Name: lowercase letters, digits and underscores only. Category: "Marketing" or "Utility" (one-time-code templates and sending codes use the public API: POST /templates with category Authentication, then POST /verifications). Use {{1}}, {{2}}… in body_text for variables and provide one sample per variable in sample_values.body, Meta rejects templates without examples. Header: optional text (header_content, max 60 chars) or media (header_media_url). Max 10 buttons (≤2 URL, ≤1 phone, ≤1 copy-code). This submits to Meta on the user’s behalf, confirm the wording with the user first. If the account has several WhatsApp numbers, pass whatsapp_config_id.',
        inputSchema: {
          name: z.string().describe('Lowercase letters, digits, underscores, e.g. order_update.'),
          category: z.enum(['Marketing', 'Utility']),
          language: z.string().describe('Language code, e.g. "en_US".'),
          body_text: z.string().describe('Body, up to 1024 chars. Variables as {{1}}, {{2}}.'),
          header_type: z.enum(['text', 'image', 'video', 'document']).optional(),
          header_content: z.string().optional().describe('Header text when header_type is "text".'),
          header_media_url: z.string().url().optional().describe('Public URL of the header media.'),
          footer_text: z.string().optional().describe('Footer, up to 60 chars.'),
          buttons: z
            .array(
              z.discriminatedUnion('type', [
                z.object({ type: z.literal('QUICK_REPLY'), text: z.string() }),
                z.object({
                  type: z.literal('URL'),
                  text: z.string(),
                  url: z.string(),
                  example: z.string().optional(),
                }),
                z.object({ type: z.literal('PHONE_NUMBER'), text: z.string(), phone_number: z.string() }),
                z.object({ type: z.literal('COPY_CODE'), text: z.string(), example: z.string() }),
              ]),
            )
            .optional(),
          sample_values: z
            .object({
              body: z.array(z.string()).optional().describe('One example per body variable, in order.'),
              header: z.array(z.string()).optional(),
            })
            .optional(),
          whatsapp_config_id: z
            .string()
            .optional()
            .describe('Which WhatsApp number/WABA to submit under, if the account has several.'),
        },
        annotations: { ...WRITE, title: 'Create message template' },
      },
      run(async (a) => api.createTemplate(a)),
    )
  }

  if (has(scopes, 'broadcasts:send')) {
    server.registerTool(
      'send_broadcast',
      {
        title: 'Send broadcast',
        description:
          'Launch a template broadcast to up to 1000 recipients, a mass, irreversible send. You MUST set confirm=true, and should show the full recipient list and template to the user for approval first. Returns quickly; poll get_broadcast for progress.',
        inputSchema: {
          name: z.string().describe('Campaign name.'),
          template_name: z.string(),
          template_language: z.string(),
          recipients: z
            .array(z.object({ to: z.string(), params: z.array(z.string()).optional() }))
            .min(1)
            .max(1000)
            .optional()
            .describe('Explicit recipients. Omit when using segment_id or filter.'),
          segment_id: z.string().optional().describe('Send to everyone currently in this segment (max 1000).'),
          filter: z.record(z.string(), z.unknown()).optional().describe('Ad hoc filter instead of a saved segment.'),
          params: z.array(z.string()).optional().describe('Template params shared by every segment/filter recipient.'),
          confirm: z.boolean().describe('Must be true to actually send.'),
        },
        annotations: { ...WRITE, destructiveHint: true, title: 'Send broadcast' },
      },
      run(async ({ confirm, ...body }) => {
        if (confirm !== true) {
          return errorResult(
            `Refusing to send: confirm must be true. This would message ${body.recipients?.length ?? 'every contact in the segment/filter'} recipient(s). ` +
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

  registerBuilderTools(server, api, scopes)
  registerCustomTools(server, api, scopes)
  registerFormsTools(server, api, scopes)
  registerDevTools(server, api, scopes)
  registerOpsTools(server, api, scopes)
  registerGuidance(server)

  return server
}
