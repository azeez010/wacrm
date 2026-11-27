/**
 * MCP tools for the developer-facing parts of the API: outbound webhooks, WhatsApp
 * verification codes (OTP), message status, plan usage, and single-record reads.
 * Registered per request from the key's scopes; the API re-checks scopes and plan gates.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { WEBHOOK_EVENTS } from '@/lib/webhooks/events'
import type { ApiClient } from './dispatch'
import { DESTRUCTIVE, READ, WRITE, has, run } from './helpers'

const events = z.array(z.enum(WEBHOOK_EVENTS)).min(1).describe('Events to deliver, e.g. ["message.received","form.submitted"].')

export function registerDevTools(server: McpServer, api: ApiClient, scopes: string[]) {
  // Plan and usage need a valid key but no scope.
  server.registerTool(
    'get_usage',
    {
      title: 'Plan and usage',
      description: 'The account’s plan, what it includes, and how much of each limit is used this period. Check before bulk work so you stop before hitting a limit.',
      inputSchema: {},
      annotations: { ...READ, title: 'Plan and usage' },
    },
    run(async () => api.getUsage()),
  )

  server.registerTool(
    'get_plan',
    {
      title: 'Plan and limits',
      description:
        'The current plan (status, renewal or trial end), every limit with used / limit and near_limit / at_limit flags, the features included, what a lower plan archived (archived_by_plan: forms, automations, contacts…, restored on upgrade) and the upgrade_url. Check before creating things in bulk; when a limit is reached, give the user the upgrade_url instead of retrying.',
      inputSchema: {},
      annotations: { ...READ, title: 'Plan and limits' },
    },
    run(async () => api.getPlan()),
  )

  server.registerTool(
    'list_plans',
    {
      title: 'List plans',
      description:
        'Public plans with prices (monthly, quarterly, annual), trial days, limits and features. Pass limit_key (and optionally used) or feature to get recommended_plan_id: the cheapest plan above the current one that fits. Plans are changed by the user in Billing (upgrade_url), never through the API.',
      inputSchema: {
        limit_key: z.string().optional().describe('A limit key from get_plan, e.g. "contacts", "forms_max", "workspaces".'),
        used: z.number().int().min(0).optional().describe('How many the user needs, for the recommendation.'),
        feature: z.string().optional().describe('A feature key from get_plan, e.g. "broadcasts".'),
      },
      annotations: { ...READ, title: 'List plans' },
    },
    run(async ({ limit_key, used, feature }) => api.listPlans({ limit_key, used, feature })),
  )

  if (has(scopes, 'messages:read')) {
    server.registerTool(
      'get_message',
      {
        title: 'Get message',
        description: 'One sent or received message with its delivery status (sent, delivered, read, failed).',
        inputSchema: { message_id: z.string() },
        annotations: { ...READ, title: 'Get message' },
      },
      run(async ({ message_id }) => api.getMessage(message_id)),
    )
  }

  if (has(scopes, 'pipelines:read')) {
    server.registerTool(
      'get_pipeline',
      {
        title: 'Get pipeline',
        description: 'One pipeline with its stages.',
        inputSchema: { pipeline_id: z.string() },
        annotations: { ...READ, title: 'Get pipeline' },
      },
      run(async ({ pipeline_id }) => api.getPipeline(pipeline_id)),
    )
    server.registerTool(
      'get_deal',
      {
        title: 'Get deal',
        description: 'One deal with its stage, value and contact.',
        inputSchema: { deal_id: z.string() },
        annotations: { ...READ, title: 'Get deal' },
      },
      run(async ({ deal_id }) => api.getDeal(deal_id)),
    )
  }

  if (has(scopes, 'webhooks:manage')) {
    server.registerTool(
      'list_webhooks',
      {
        title: 'List webhooks',
        description: 'Outbound webhook endpoints: url, subscribed events, active flag and last delivery.',
        inputSchema: {},
        annotations: { ...READ, title: 'List webhooks' },
      },
      run(async () => api.listWebhooks()),
    )
    server.registerTool(
      'get_webhook',
      {
        title: 'Get webhook',
        description: 'One webhook endpoint (the signing secret is never shown again after creation).',
        inputSchema: { webhook_id: z.string() },
        annotations: { ...READ, title: 'Get webhook' },
      },
      run(async ({ webhook_id }) => api.getWebhook(webhook_id)),
    )
    server.registerTool(
      'create_webhook',
      {
        title: 'Create webhook',
        description:
          'Register an HTTPS endpoint to receive events. The response includes the signing `secret` ONCE: tell the user to store it now (it verifies the X-Wacrm-Signature header) because it cannot be shown again.',
        inputSchema: { url: z.string().url().describe('Public HTTPS URL that accepts POST.'), events },
        annotations: { ...WRITE, title: 'Create webhook' },
      },
      run(async (a) => api.createWebhook(a)),
    )
    server.registerTool(
      'update_webhook',
      {
        title: 'Update webhook',
        description: 'Change a webhook’s url, subscribed events, or pause/resume it with is_active.',
        inputSchema: { webhook_id: z.string(), url: z.string().url().optional(), events: events.optional(), is_active: z.boolean().optional() },
        annotations: { ...WRITE, title: 'Update webhook' },
      },
      run(async ({ webhook_id, ...body }) => api.updateWebhook(webhook_id, body)),
    )
    server.registerTool(
      'delete_webhook',
      {
        title: 'Delete webhook',
        description: 'Remove a webhook endpoint. It stops receiving events immediately.',
        inputSchema: { webhook_id: z.string() },
        annotations: { ...DESTRUCTIVE, title: 'Delete webhook' },
      },
      run(async ({ webhook_id }) => api.deleteWebhook(webhook_id)),
    )
  }

  if (has(scopes, 'otp:send')) {
    server.registerTool(
      'send_verification',
      {
        title: 'Send verification code',
        description:
          'Send a one-time code to a phone over WhatsApp (this messages a real person: only call it when the user asked to). The code is never returned; verify what the person typed with check_verification.',
        inputSchema: {
          to: z.string().describe('International format, e.g. +2348012345678.'),
          code_length: z.number().int().min(4).max(8).optional().describe('Digits when we generate the code (default 6).'),
          ttl_seconds: z.number().int().min(60).max(900).optional().describe('How long the code stays valid (default 300).'),
          whatsapp_config_id: z.string().optional().describe('Needed only with several WhatsApp numbers.'),
          template: z.object({ name: z.string(), language: z.string() }).optional().describe('An approved authentication template, e.g. otp_verification / en_US.'),
          metadata: z.record(z.string(), z.unknown()).optional().describe('Echoed back, up to 1 KB.'),
        },
        annotations: { ...WRITE, title: 'Send verification code' },
      },
      run(async (a) => api.sendVerification(a)),
    )
  }

  if (has(scopes, 'otp:verify')) {
    server.registerTool(
      'get_verification',
      {
        title: 'Get verification',
        description: 'Status of a verification (pending, verified, expired, failed) and attempts used.',
        inputSchema: { verification_id: z.string() },
        annotations: { ...READ, title: 'Get verification' },
      },
      run(async ({ verification_id }) => api.getVerification(verification_id)),
    )
    server.registerTool(
      'check_verification',
      {
        title: 'Check verification code',
        description: 'Check the code a person typed against a verification. Wrong attempts are limited.',
        inputSchema: { verification_id: z.string(), code: z.string() },
        annotations: { ...WRITE, title: 'Check verification code' },
      },
      run(async ({ verification_id, code }) => api.checkVerification(verification_id, code)),
    )
  }
}
