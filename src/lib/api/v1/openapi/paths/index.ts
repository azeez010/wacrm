import { WEBHOOK_EVENTS, WEBHOOK_EVENT_DESCRIPTIONS } from '@/lib/webhooks/events'
import type { OpenApiObject, PathItems } from '../types'
import { verificationPaths } from './verifications'

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const res = (name: string) => ({ $ref: `#/components/responses/${name}` })
const idParam = (name: string, description: string) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string', format: 'uuid' },
})
const limitParam = {
  name: 'limit',
  in: 'query',
  description: 'Page size, 1 to 100.',
  schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
}
const cursorParam = {
  name: 'cursor',
  in: 'query',
  description: "Opaque cursor from the previous response's `meta.next_cursor`.",
  schema: { type: 'string' },
}
const errors = (...names: string[]) =>
  Object.fromEntries(names.map((n) => [STATUS[n], res(n)])) as Record<string, OpenApiObject>
const STATUS: Record<string, string> = {
  BadRequest: '400',
  Unauthorized: '401',
  PlanLimit: '402',
  Forbidden: '403',
  NotFound: '404',
  Conflict: '409',
  RateLimited: '429',
  MetaError: '502',
}
const listOf = (item: string) => ({
  type: 'object',
  properties: { data: { type: 'array', items: ref(item) }, meta: ref('PageMeta') },
})
const wrap = (item: string) => ({ type: 'object', properties: { data: ref(item) } })
const json = (schema: OpenApiObject) => ({ 'application/json': { schema } })
const eventList = WEBHOOK_EVENTS.map((e) => `- \`${e}\`: ${WEBHOOK_EVENT_DESCRIPTIONS[e]}`).join('\n')

export const paths: PathItems = {
  ...verificationPaths,
  '/me': {
    get: {
      tags: ['Account'],
      operationId: 'getMe',
      summary: 'Check your key',
      description: 'Returns the workspace and the scopes of the API key in use. Needs no scope, so it is the easiest way to confirm a key works.',
      responses: {
        '200': {
          description: 'The key is valid.',
          content: json({
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  account: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } },
                  key: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, scopes: { type: 'array', items: { type: 'string' } } } },
                },
              },
            },
          }),
        },
        ...errors('Unauthorized', 'RateLimited'),
      },
    },
  },
  '/usage': {
    get: {
      tags: ['Account'],
      operationId: 'getUsage',
      summary: 'See your plan and usage',
      description:
        'Your plan, the current allowance period and how much of each limit you have used. Needs a valid key but no scope.',
      responses: {
        '200': { description: 'Usage.', content: json(wrap('Usage')) },
        ...errors('Unauthorized', 'PlanLimit', 'RateLimited'),
      },
    },
  },
  '/plan': {
    get: {
      tags: ['Account'],
      operationId: 'getPlan',
      summary: 'See your plan and limits',
      description:
        'The current plan, every limit with what is used (`near_limit` from 80%, `at_limit` when full), the features included, the items a lower plan archived (`archived_by_plan`, restored automatically on upgrade) and the `upgrade_url`. Needs a valid key but no scope.',
      responses: {
        '200': { description: 'Plan and limits.', content: json({ type: 'object', properties: { data: { type: 'object' } } }) },
        ...errors('Unauthorized', 'PlanLimit', 'RateLimited'),
      },
    },
  },
  '/plans': {
    get: {
      tags: ['Account'],
      operationId: 'listPlans',
      summary: 'List plans',
      description:
        'Public plans with prices, trial days, limits and features. With `limit_key` (and optional `used`) or `feature`, `recommended_plan_id` names the cheapest plan above the current one that fits. Plans are changed in the app (Settings > Billing), not through the API. Needs a valid key but no scope.',
      parameters: [
        { name: 'limit_key', in: 'query', required: false, schema: { type: 'string' }, description: 'A limit key, e.g. `contacts` or `forms_max`.' },
        { name: 'used', in: 'query', required: false, schema: { type: 'integer', minimum: 0 }, description: 'How many are needed, for the recommendation.' },
        { name: 'feature', in: 'query', required: false, schema: { type: 'string' }, description: 'A feature key, e.g. `broadcasts`.' },
      ],
      responses: {
        '200': { description: 'Plans.', content: json({ type: 'object', properties: { data: { type: 'object' } } }) },
        ...errors('Unauthorized', 'BadRequest', 'PlanLimit', 'RateLimited'),
      },
    },
  },
  '/workspace': {
    get: {
      tags: ['Workspace'],
      operationId: 'getWorkspace',
      summary: 'Get the workspace',
      description: 'Name, timezone, currency, plan, owner and team size by role. Requires `workspace:read`.',
      responses: { '200': { description: 'The workspace.', content: json({ type: 'object', properties: { data: { type: 'object' } } }) }, ...errors('Unauthorized', 'Forbidden', 'RateLimited') },
    },
    patch: {
      tags: ['Workspace'],
      operationId: 'updateWorkspace',
      summary: 'Rename the workspace or change its timezone',
      description: 'Send `name` (1-80 characters) and/or `timezone` (IANA). Requires `workspace:manage`.',
      requestBody: {
        required: true,
        content: json({ type: 'object', properties: { name: { type: 'string', maxLength: 80 }, timezone: { type: 'string', example: 'Africa/Lagos' } } }),
      },
      responses: { '200': { description: 'Updated.', content: json({ type: 'object', properties: { data: { type: 'object' } } }) }, ...errors('BadRequest', 'Unauthorized', 'Forbidden', 'RateLimited') },
    },
  },
  '/invitations': {
    get: {
      tags: ['Workspace'],
      operationId: 'listInvitations',
      summary: 'List pending invitations',
      description: 'Invitations not yet used and not expired. Requires `workspace:read`.',
      responses: { '200': { description: 'Invitations.', content: json({ type: 'object', properties: { data: { type: 'object' } } }) }, ...errors('Unauthorized', 'Forbidden', 'RateLimited') },
    },
    post: {
      tags: ['Workspace'],
      operationId: 'createInvitation',
      summary: 'Invite a teammate',
      description:
        'Creates a one-time invite link. The `url` is returned only in this response. Members plus pending invitations count toward the plan seat limit (`402 plan_limit`). Requires `workspace:manage`.',
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['admin', 'agent', 'viewer'], default: 'agent' },
            label: { type: 'string', maxLength: 80 },
            expires_in_days: { type: 'integer', minimum: 1, maximum: 30 },
          },
        }),
      },
      responses: { '201': { description: 'Created.', content: json({ type: 'object', properties: { data: { type: 'object' } } }) }, ...errors('BadRequest', 'Unauthorized', 'PlanLimit', 'Forbidden', 'RateLimited') },
    },
  },
  '/invitations/{id}': {
    delete: {
      tags: ['Workspace'],
      operationId: 'revokeInvitation',
      summary: 'Revoke an invitation',
      description: 'The link stops working. Requires `workspace:manage`.',
      parameters: [idParam('id', 'Invitation id.')],
      responses: { '200': { description: 'Revoked.', content: json({ type: 'object', properties: { data: { type: 'object' } } }) }, ...errors('Unauthorized', 'Forbidden', 'NotFound', 'RateLimited') },
    },
  },
  '/workspaces': {
    get: {
      tags: ['Workspace'],
      operationId: 'listWorkspaces',
      summary: 'List your workspaces',
      description:
        'Every workspace the person who created the key belongs to, with their role and plan; `this_key` marks the one this key works in. Requires `workspaces:manage` (only on keys created in Settings).',
      responses: { '200': { description: 'Workspaces.', content: json({ type: 'object', properties: { data: { type: 'object' } } }) }, ...errors('Unauthorized', 'Forbidden', 'RateLimited') },
    },
    post: {
      tags: ['Workspace'],
      operationId: 'createWorkspace',
      summary: 'Create a workspace',
      description:
        'Creates a workspace owned by the key creator. The plan workspaces limit applies (`402 plan_limit`). It does not switch their active workspace, and this key cannot act in it: create a key inside the new workspace. Requires `workspaces:manage`.',
      requestBody: { required: true, content: json({ type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 80 } } }) },
      responses: { '201': { description: 'Created.', content: json({ type: 'object', properties: { data: { type: 'object' } } }) }, ...errors('BadRequest', 'Unauthorized', 'PlanLimit', 'Forbidden', 'RateLimited') },
    },
  },
  '/messages': {
    post: {
      tags: ['Messages'],
      operationId: 'sendMessage',
      summary: 'Send a message',
      description:
        'Sends a WhatsApp message to a phone number. The contact and conversation are created automatically if they do not exist.\n\n' +
        'Outside the 24-hour customer-service window only an approved **template** can be sent. Requires the `messages:send` scope.\n\n' +
        'Delivery is asynchronous: a `201` means WhatsApp accepted the message. Track `sent`, `delivered`, `read` and `failed` with the `message.status_updated` webhook or by listing the conversation messages.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: ref('SendMessageRequest'),
            examples: {
              text: { summary: 'Text', value: { to: '+2348012345678', type: 'text', text: 'Your order has shipped.' } },
              template: {
                summary: 'Template with variables',
                value: { to: '+2348012345678', type: 'template', template: { name: 'order_update', language: 'en_US', params: ['A123', 'Friday'] } },
              },
              image: { summary: 'Image with caption', value: { to: '+2348012345678', type: 'image', media_url: 'https://example.com/receipt.png', text: 'Your receipt' } },
              buttons: {
                summary: 'Reply buttons',
                value: {
                  to: '+2348012345678',
                  type: 'interactive',
                  interactive_payload: { kind: 'buttons', body: 'Did this solve it?', buttons: [{ id: 'yes', title: 'Yes' }, { id: 'no', title: 'No' }] },
                },
              },
            },
          },
        },
      },
      responses: {
        '201': { description: 'Accepted by WhatsApp.', content: json(ref('SendMessageResponse')) },
        '400': { description: 'Invalid input, or no WhatsApp number is connected (`whatsapp_not_configured`).', content: json(ref('Error')) },
        '402': res('PlanLimit'),
        ...errors('Unauthorized', 'Forbidden', 'RateLimited', 'MetaError'),
      },
    },
  },
  '/conversations/{id}/messages': {
    get: {
      tags: ['Messages'],
      operationId: 'listConversationMessages',
      summary: 'List messages in a conversation',
      description: 'Newest first. Use it to read the delivery `status` of messages you sent. Requires the `messages:read` scope.',
      parameters: [idParam('id', 'Conversation id (`conversation_id` from the send response).'), limitParam, cursorParam],
      responses: {
        '200': { description: 'A page of messages.', content: json(listOf('Message')) },
        ...errors('Unauthorized', 'Forbidden', 'NotFound', 'RateLimited'),
      },
    },
  },
  '/templates': {
    get: {
      tags: ['Templates'],
      operationId: 'listTemplates',
      summary: 'List templates',
      description: 'Message templates and their Meta approval status. Requires the `templates:read` scope.',
      parameters: [
        limitParam,
        cursorParam,
        {
          name: 'status',
          in: 'query',
          description: 'Filter by approval status.',
          schema: { type: 'string', enum: ['APPROVED', 'PENDING', 'REJECTED', 'DRAFT', 'PAUSED', 'DISABLED'] },
        },
      ],
      responses: {
        '200': { description: 'A page of templates.', content: json(listOf('Template')) },
        ...errors('Unauthorized', 'Forbidden', 'RateLimited'),
      },
    },
    post: {
      tags: ['Templates'],
      operationId: 'createTemplate',
      summary: 'Create a template',
      description:
        "Creates a template and submits it to Meta for review (usually answered within 24 hours). The workspace needs a connected WhatsApp number; with several numbers pass `whatsapp_config_id`. Requires the `templates:write` scope.",
      requestBody: { required: true, content: json(ref('CreateTemplateRequest')) },
      responses: {
        '201': { description: 'Saved and submitted. Check `status`.', content: json(wrap('Template')) },
        ...errors('BadRequest', 'Unauthorized', 'Forbidden', 'Conflict', 'RateLimited', 'MetaError'),
      },
    },
  },
  '/webhooks': {
    get: {
      tags: ['Webhooks'],
      operationId: 'listWebhooks',
      summary: 'List webhook endpoints',
      description: 'Requires the `webhooks:manage` scope. The signing secret is never returned here.',
      responses: {
        '200': { description: 'Your endpoints.', content: json(listOf('WebhookEndpoint')) },
        ...errors('Unauthorized', 'Forbidden', 'RateLimited'),
      },
    },
    post: {
      tags: ['Webhooks'],
      operationId: 'createWebhook',
      summary: 'Register a webhook endpoint',
      description:
        'The URL must be `https`. The response includes the signing `secret` (`whsec_…`) **once**; store it to verify deliveries. Requires the `webhooks:manage` scope.\n\nEvents:\n' +
        eventList,
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['url', 'events'],
          properties: {
            url: { type: 'string', format: 'uri', examples: ['https://example.com/hooks/ogadesk'] },
            events: { type: 'array', minItems: 1, items: { type: 'string', enum: [...WEBHOOK_EVENTS] } },
          },
        }),
      },
      responses: {
        '201': {
          description: 'Created.',
          content: json({
            type: 'object',
            properties: {
              data: {
                allOf: [ref('WebhookEndpoint'), { type: 'object', properties: { secret: { type: 'string', description: 'Shown only now.' } } }],
              },
            },
          }),
        },
        ...errors('BadRequest', 'Unauthorized', 'Forbidden', 'RateLimited'),
      },
    },
  },
  '/webhooks/{id}': {
    get: {
      tags: ['Webhooks'],
      operationId: 'getWebhook',
      summary: 'Get a webhook endpoint',
      parameters: [idParam('id', 'Webhook endpoint id.')],
      responses: {
        '200': { description: 'The endpoint.', content: json(wrap('WebhookEndpoint')) },
        ...errors('Unauthorized', 'Forbidden', 'NotFound', 'RateLimited'),
      },
    },
    patch: {
      tags: ['Webhooks'],
      operationId: 'updateWebhook',
      summary: 'Update a webhook endpoint',
      description: 'Send any of `url`, `events`, `is_active`. Setting `is_active` to `true` re-enables an endpoint that was disabled after repeated failures and resets its failure count.',
      parameters: [idParam('id', 'Webhook endpoint id.')],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          properties: {
            url: { type: 'string', format: 'uri' },
            events: { type: 'array', minItems: 1, items: { type: 'string', enum: [...WEBHOOK_EVENTS] } },
            is_active: { type: 'boolean' },
          },
        }),
      },
      responses: {
        '200': { description: 'Updated.', content: json(wrap('WebhookEndpoint')) },
        ...errors('BadRequest', 'Unauthorized', 'Forbidden', 'NotFound', 'RateLimited'),
      },
    },
    delete: {
      tags: ['Webhooks'],
      operationId: 'deleteWebhook',
      summary: 'Delete a webhook endpoint',
      parameters: [idParam('id', 'Webhook endpoint id.')],
      responses: {
        '200': {
          description: 'Deleted.',
          content: json({
            type: 'object',
            properties: { data: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, deleted: { type: 'boolean' } } } },
          }),
        },
        ...errors('Unauthorized', 'Forbidden', 'NotFound', 'RateLimited'),
      },
    },
  },
}
