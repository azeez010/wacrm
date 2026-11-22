// ============================================================
// Write tools — registered only when WACRM_ENABLE_WRITES is set.
//
// These change data or send a WhatsApp message. They are gated so a
// read-only deployment never exposes them to the model at all. (The
// API key's scopes are still enforced server-side; a call without the
// right scope returns a clean `forbidden` error.)
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from '../client.js';
import { handle, jsonResult } from './shared.js';

const templateSchema = z
  .object({
    name: z.string().describe('Meta-approved template name.'),
    language: z.string().describe('Template language code, e.g. "en_US".'),
    params: z
      .array(z.string())
      .optional()
      .describe('Positional body variables, in order.'),
  })
  .describe('Template payload — required when type is "template".');

export function registerWriteTools(server: McpServer, client: WacrmClient): void {
  server.registerTool(
    'send_message',
    {
      title: 'Send WhatsApp message',
      description:
        'Send a WhatsApp message to a phone number (E.164, e.g. +14155550123). The contact and conversation are found-or-created automatically. Use type "text" for a free-form message (only valid inside the 24-hour customer-service window), or "template" to send an approved template (required to open a new conversation). Media types (image/video/document/audio) require a media_url. This sends a real message to a real person — confirm the recipient and content with the user before calling.',
      inputSchema: {
        to: z.string().describe('Recipient phone number in E.164 format, e.g. +14155550123.'),
        type: z
          .enum(['text', 'template', 'image', 'video', 'document', 'audio'])
          .default('text')
          .describe('Message type. Defaults to "text".'),
        text: z
          .string()
          .optional()
          .describe('Message body for "text", or the caption for a media type.'),
        media_url: z
          .string()
          .url()
          .optional()
          .describe('Publicly reachable URL of the media file (required for media types).'),
        filename: z.string().optional().describe('File name for a "document" send.'),
        template: templateSchema.optional(),
        reply_to_message_id: z
          .string()
          .optional()
          .describe('Optional id of a message in the same conversation to reply to.'),
      },
      annotations: { title: 'Send WhatsApp message', readOnlyHint: false, openWorldHint: true },
    },
    handle(async (args) => jsonResult(await client.sendMessage(args))),
  );

  server.registerTool(
    'create_contact',
    {
      title: 'Create contact',
      description:
        'Create a contact by phone number (E.164, required). Find-or-create: if a contact with that phone already exists, its name, email and company are left unchanged and any tags you pass are added to the tags it already has (none are removed). Optional: name, email, company, and tags (tag names, created if missing).',
      inputSchema: {
        phone: z.string().describe('Phone number in E.164 format, e.g. +14155550123.'),
        name: z.string().optional(),
        email: z.string().email().optional(),
        company: z.string().optional(),
        tags: z.array(z.string()).optional().describe('Tag names; created if they do not exist. Added to an existing contact’s tags, never replacing them.'),
      },
      annotations: { title: 'Create contact', readOnlyHint: false, openWorldHint: true },
    },
    handle(async (args) => jsonResult(await client.createContact(args))),
  );

  server.registerTool(
    'update_contact',
    {
      title: 'Update contact',
      description:
        'Update an existing contact. Only the fields you pass are changed. Pass tags (an array of tag names) to replace the contact’s tags entirely.',
      inputSchema: {
        id: z.string().describe('Contact id.'),
        name: z.string().optional(),
        email: z.string().email().optional(),
        company: z.string().optional(),
        tags: z.array(z.string()).optional().describe('Replaces the contact’s tags.'),
        blocked: z.boolean().optional().describe('true blocks the contact (no message of any kind is sent to them); false unblocks.'),
      },
      annotations: { title: 'Update contact', readOnlyHint: false, openWorldHint: true },
    },
    handle(async ({ id, ...body }) => jsonResult(await client.updateContact(id, body))),
  );

  server.registerTool(
    'create_form',
    {
      title: 'Create form',
      description:
        'Create a lead form or support button from a template (blank, contact, newsletter, webinar, quote, event, support) as a DRAFT. It is not public until update_form sets status "active".',
      inputSchema: {
        template: z.enum(['blank', 'contact', 'newsletter', 'webinar', 'quote', 'event', 'support']).default('blank'),
        name: z.string().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: true, title: 'Create form' },
    },
    handle(async (args) => jsonResult(await client.createForm(args))),
  );

  server.registerTool(
    'update_form',
    {
      title: 'Update form',
      description:
        'Edit a form: name, status (draft|active|paused), fields, settings. fields and settings are replaced as a whole: call get_form and send the full object back with your edits. Setting status "active" makes the form public, so confirm with the user first.',
      inputSchema: {
        form_id: z.string(),
        name: z.string().optional(),
        status: z.enum(['draft', 'active', 'paused']).optional(),
        fields: z.array(z.record(z.string(), z.unknown())).optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: true, title: 'Update form' },
    },
    handle(async ({ form_id, ...body }) => jsonResult(await client.updateForm(form_id, body))),
  );

  server.registerTool(
    'archive_form',
    {
      title: 'Archive form',
      description: 'Archive a form: it stops accepting leads. Existing leads and contacts are kept.',
      inputSchema: { form_id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, title: 'Archive form' },
    },
    handle(async ({ form_id }) => jsonResult(await client.archiveForm(form_id))),
  );

  server.registerTool(
    'submit_form_lead',
    {
      title: 'Submit a lead to a form',
      description: 'Submit a lead to a form as if it was filled in: runs the full pipeline (contact, tags, automations, webhook). answers is keyed by the form field ids (see get_form); phone is required.',
      inputSchema: {
        form_id: z.string(),
        answers: z.record(z.string(), z.unknown()),
        utm: z.record(z.string(), z.string()).optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: true, title: 'Submit a lead to a form' },
    },
    handle(async ({ form_id, answers, utm }) => jsonResult(await client.submitFormLead(form_id, { answers, utm }))),
  );
}
