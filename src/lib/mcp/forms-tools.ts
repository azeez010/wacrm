/**
 * MCP tools for forms (lead capture): read, create from a template, edit,
 * publish/pause, archive, and submit a lead. Registered per request from the
 * key's scopes, like every other tool; the API re-checks scopes and plan limits.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { ApiClient } from './dispatch'
import { DESTRUCTIVE, READ, WRITE, cursor, has, limit, run, text } from './helpers'

export const FORMS_REFERENCE = {
  overview:
    'A form collects leads into Contacts. Two kinds: "lead" (hosted page / QR / embed) and "support" (a floating WhatsApp button for a website). Every lead is matched to a contact by phone number and tagged; lead source and UTM are stored once.',
  build_order: [
    '1. create_form from a template (blank, contact, newsletter, webinar, quote, event, support). It starts as a draft.',
    '2. get_form to read the editable definition, then update_form with the changes (fields and/or settings), and status "active" to publish.',
    '3. Share the returned url (lead form) or embed_script (support button).',
  ],
  templates: ['blank', 'contact', 'newsletter', 'webinar', 'quote', 'event', 'support'],
  field_kinds: {
    phone: 'Always present and required. Cannot be removed.',
    name: 'Short text.',
    email: 'Email address.',
    company: 'Short text.',
    message: 'Long text; can be saved as a contact note and inserted in the WhatsApp text.',
    custom_field: '{ kind, customFieldId } asks one of the account\'s contact custom fields (use list custom fields). Choice fields take options (a subset), points and disqualify.',
    table_column: '{ kind, tableRef: { fieldId, columnKey } } fills a column of a custom table behind a reference field.',
    tag_picker: '{ kind, tagIds } lets the visitor choose among those tags.',
    consent: '{ kind, required, consentText, privacyUrl }. Opt-in proof is stored when ticked.',
    hidden: '{ kind, param, fixedValue } filled from ?param=value in the link, or a fixed value.',
    heading: '{ kind, text } a note between fields.',
  },
  field_shape: { id: 'unique short string', kind: 'one of the kinds above', label: 'string', help: 'optional', placeholder: 'optional', required: 'boolean' },
  settings: {
    title: 'string', description: 'string', buttonText: 'string', accent: '#RRGGBB', language: 'en|es|fr|pt|ko', defaultCountry: 'ISO code, e.g. NG',
    success: '{ action: "message"|"redirect"|"whatsapp", message, redirectUrl, whatsappText ("Hi, I am {{name}}. {{message}}"), followUpLine }',
    autoTag: 'tag name added to every lead (created if missing); null for none',
    assignment: '{ mode: "none"|"agent"|"round_robin", agentIds: [user ids] }  (round_robin needs the forms_advanced plan feature)',
    qualification: '{ enabled, threshold, onUnqualified: "save"|"block", blockMessage }  (needs forms_advanced)',
    rules: '{ onePerPhone, repeatWindowHours, maxSubmissions, opensAt, closesAt, closedMessage, turnstile, retentionDays, saveMessageAsNote }',
    widget: 'support only: { corner: "bottom-left"|"bottom-right", offsetX, offsetY, label, color, icon: "whatsapp"|"chat"|"headset", greeting, showOn, urlContains, devices, hours }',
    pipeline: '{ pipelineId, stageId } creates a deal on submit (needs forms_advanced)',
    welcomeTemplate: '{ name, language, params } approved template sent to consenting new leads (needs forms_advanced)',
  },
  notes: [
    'update_form replaces fields and settings with what you send: call get_form first and send the full object back with your edits.',
    'Publishing (status "active") makes the form public. Confirm with the user first.',
    'Plan limits apply: form count and monthly leads; over the monthly quota leads are held, not lost.',
  ],
}

const looseObj = z.record(z.string(), z.unknown())

export function registerFormsTools(server: McpServer, api: ApiClient, scopes: string[]) {
  if (has(scopes, 'forms:read')) {
    server.registerTool(
      'get_forms_reference',
      {
        title: 'Forms authoring guide',
        description: 'READ THIS FIRST before create_form/update_form: templates, field kinds, every setting and its shape, build order.',
        inputSchema: {},
        annotations: { ...READ, title: 'Forms authoring guide' },
      },
      async () => text(FORMS_REFERENCE),
    )
    server.registerTool(
      'list_forms',
      {
        title: 'List forms',
        description: 'List the account’s lead forms and support buttons with their link, embed code and status.',
        inputSchema: {},
        annotations: { ...READ, title: 'List forms' },
      },
      run(async () => api.listForms()),
    )
    server.registerTool(
      'get_form',
      {
        title: 'Get form',
        description: 'The full editable definition of one form (fields and settings).',
        inputSchema: { form_id: z.string() },
        annotations: { ...READ, title: 'Get form' },
      },
      run(async ({ form_id }) => api.getForm(form_id)),
    )
    server.registerTool(
      'list_form_submissions',
      {
        title: 'List form submissions',
        description: 'Leads submitted to a form, newest first: answers, score, qualified, outcome and UTM source. Paginated.',
        inputSchema: { form_id: z.string(), limit, cursor },
        annotations: { ...READ, title: 'List form submissions' },
      },
      run(async ({ form_id, limit: l, cursor: c }) => api.listFormSubmissions(form_id, { limit: l, cursor: c })),
    )
  }

  if (has(scopes, 'forms:manage')) {
    server.registerTool(
      'create_form',
      {
        title: 'Create form',
        description: 'Create a form or support button from a template, as a DRAFT (not public). Read get_forms_reference first.',
        inputSchema: {
          template: z.enum(['blank', 'contact', 'newsletter', 'webinar', 'quote', 'event', 'support']).default('blank'),
          name: z.string().optional(),
        },
        annotations: { ...WRITE, title: 'Create form' },
      },
      run(async (a) => api.createForm(a)),
    )
    server.registerTool(
      'update_form',
      {
        title: 'Update form',
        description:
          'Edit a form: name, status (draft|active|paused), fields, settings. Only the keys you pass change, but fields and settings are replaced as a whole, so send the full object from get_form with your edits. status "active" publishes it: confirm with the user first.',
        inputSchema: {
          form_id: z.string(),
          name: z.string().optional(),
          status: z.enum(['draft', 'active', 'paused']).optional(),
          fields: z.array(looseObj).optional(),
          settings: looseObj.optional(),
        },
        annotations: { ...WRITE, title: 'Update form' },
      },
      run(async ({ form_id, ...body }) => api.updateForm(form_id, body)),
    )
    server.registerTool(
      'archive_form',
      {
        title: 'Archive form',
        description: 'Archive a form: it stops accepting leads and leaves the list. Existing leads and contacts are kept.',
        inputSchema: { form_id: z.string() },
        annotations: { ...DESTRUCTIVE, title: 'Archive form' },
      },
      run(async ({ form_id }) => api.archiveForm(form_id)),
    )
  }

  if (has(scopes, 'forms:write')) {
    server.registerTool(
      'submit_form_lead',
      {
        title: 'Submit a lead to a form',
        description:
          'Submit a lead as if the form was filled in: runs the full pipeline (contact, tags, automations, webhook). `answers` is keyed by the form’s field ids (see get_form); phone is required.',
        inputSchema: {
          form_id: z.string(),
          answers: z.record(z.string(), z.unknown()),
          utm: z.record(z.string(), z.string()).optional().describe('e.g. {"source":"facebook","campaign":"spring"}'),
        },
        annotations: { ...WRITE, title: 'Submit a lead to a form' },
      },
      run(async ({ form_id, answers, utm }) => api.submitFormLead(form_id, { answers, utm })),
    )
  }
}
