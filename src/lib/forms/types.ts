import { BACKGROUND_FITS, BACKGROUND_OVERLAYS, BACKGROUND_POSITIONS, LOGO_ALIGNS, LOGO_SIZES } from './branding'
import { z } from 'zod'
import { CONDITION_OPS, MAX_CONDITION_RULES, findConditionProblem } from './conditions'

// ============================================================
// Forms (lead capture): the shape stored in forms.fields / forms.settings.
// Everything a public visitor can influence is validated against these.
// ============================================================

export const FORM_KINDS = ['lead', 'support'] as const
export type FormKind = (typeof FORM_KINDS)[number]

export const FORM_STATUSES = ['draft', 'active', 'paused'] as const
export type FormStatus = (typeof FORM_STATUSES)[number]

export const FORM_FIELD_KINDS = [
  'phone',
  'name',
  'email',
  'company',
  'message',
  'custom_field',
  'table_column',
  'tag_picker',
  'consent',
  'hidden',
  'heading',
] as const
export type FormFieldKind = (typeof FORM_FIELD_KINDS)[number]

export const MAX_FORM_FIELDS = 40
export const MAX_OPTIONS = 200

const shortText = z.string().trim().max(200)
const longText = z.string().trim().max(2000)

export const formFieldSchema = z
  .object({
    /** Stable id (used as the key in submissions). */
    id: z.string().trim().min(1).max(40),
    kind: z.enum(FORM_FIELD_KINDS),
    label: shortText.default(''),
    help: shortText.optional(),
    placeholder: shortText.optional(),
    required: z.boolean().optional(),
    /** custom_field: the contact custom field this answers. */
    customFieldId: z.string().uuid().optional(),
    /** table_column: the reference field + the column key of its custom table. */
    tableRef: z.object({ fieldId: z.string().uuid(), columnKey: z.string().min(1).max(80) }).optional(),
    /** Choice fields: restrict to a subset of the field's own options. */
    options: z.array(z.string().max(100)).max(MAX_OPTIONS).optional(),
    display: z.enum(['select', 'radio', 'chips']).optional(),
    /** Points per option (scoring), and options that disqualify. */
    points: z.record(z.string(), z.number().int().min(-1000).max(1000)).optional(),
    disqualify: z.array(z.string().max(100)).max(MAX_OPTIONS).optional(),
    /** tag_picker: tags the visitor may choose from. */
    tagIds: z.array(z.string().uuid()).max(50).optional(),
    /** hidden: filled from a URL parameter (or a fixed value). */
    param: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,40}$/).optional(),
    /** hidden: also save the value on the contact: 'company', 'lead_source' or 'cf:<custom field id>'. */
    targetField: z.string().trim().max(60).regex(/^(company|lead_source|cf:[0-9a-fA-F-]{36})$/).optional(),
    fixedValue: shortText.optional(),
    /** consent */
    consentText: longText.optional(),
    privacyUrl: z.string().url().max(500).optional(),
    /** heading */
    text: longText.optional(),
    /** Show this field only when the rules hold (they look at earlier fields' answers). */
    visibleWhen: z
      .object({
        match: z.enum(['all', 'any']),
        rules: z
          .array(
            z
              .object({
                fieldId: z.string().trim().min(1).max(40),
                op: z.enum(CONDITION_OPS),
                value: z.string().max(200).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(MAX_CONDITION_RULES),
      })
      .strict()
      .optional(),
  })
  .strict()
export type FormField = z.input<typeof formFieldSchema>

export const SUCCESS_ACTIONS = ['message', 'redirect', 'whatsapp'] as const

export const formSettingsSchema = z
  .object({
    title: shortText.optional(),
    description: longText.optional(),
    buttonText: shortText.optional(),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    logoUrl: z.string().url().max(500).optional(),
    /** Picture behind the hosted page (a theme-aware veil keeps the form readable). */
    backgroundImage: z.string().url().max(500).optional(),
    /** Logo layout (only used when a logo is set). */
    logoAlign: z.enum(LOGO_ALIGNS).optional(),
    logoSize: z.enum(LOGO_SIZES).optional(),
    /** Background layout (only used when a background image is set). */
    backgroundFit: z.enum(BACKGROUND_FITS).optional(),
    backgroundPosition: z.enum(BACKGROUND_POSITIONS).optional(),
    backgroundOverlay: z.enum(BACKGROUND_OVERLAYS).optional(),
    language: z.enum(['en', 'es', 'fr', 'pt', 'ko']).optional(),
    /** 'auto' = the visitor's country from Cloudflare; otherwise a fixed ISO code. */
    defaultCountry: z.union([z.literal('auto'), z.string().length(2)]).optional(),
    theme: z.enum(['auto', 'light', 'dark']).optional(),
    /** Hide the "Powered by OgaDesk" badge. Only honoured on plans with forms_advanced. */
    hideBranding: z.boolean().optional(),
    noindex: z.boolean().optional(),
    ogTitle: shortText.optional(),
    ogDescription: longText.optional(),
    ogImage: z.string().url().max(500).optional(),

    success: z
      .object({
        action: z.enum(SUCCESS_ACTIONS).default('message'),
        message: longText.optional(),
        redirectUrl: z.string().url().max(1000).optional(),
        /** Prefilled WhatsApp text; supports {{name}}, {{message}}, {{field_key}}. */
        whatsappText: longText.optional(),
        /** Show "we'll message you shortly" under the WhatsApp button. */
        followUpLine: z.boolean().optional(),
      })
      .strict()
      .default({ action: 'message' }),

    /** Tag every lead with this tag name (created on first use). null/'' = none. */
    autoTag: z.string().trim().max(60).nullable().optional(),
    tagsQualified: z.array(z.string().trim().max(60)).max(10).optional(),
    tagsNotQualified: z.array(z.string().trim().max(60)).max(10).optional(),

    assignment: z
      .object({
        mode: z.enum(['none', 'agent', 'round_robin']).default('none'),
        agentIds: z.array(z.string().uuid()).max(50).optional(),
      })
      .strict()
      .default({ mode: 'none' }),

    /** Who gets the in-app notification: everyone who handles leads (default) or only the chosen people. The assignee is always included. */
    notify: z
      .object({
        mode: z.enum(['all', 'selected']).default('all'),
        agentIds: z.array(z.string().uuid()).max(50).optional(),
      })
      .strict()
      .default({ mode: 'all' }),

    qualification: z
      .object({
        enabled: z.boolean().default(false),
        threshold: z.number().int().min(0).max(100000).default(0),
        onUnqualified: z.enum(['save', 'block']).default('save'),
        blockMessage: longText.optional(),
      })
      .strict()
      .default({ enabled: false, threshold: 0, onUnqualified: 'save' }),

    rules: z
      .object({
        onePerPhone: z.boolean().optional(),
        /** Repeat window in hours: a repeat from the same phone does not re-notify/re-run. */
        repeatWindowHours: z.number().int().min(0).max(24 * 30).optional(),
        maxSubmissions: z.number().int().min(1).max(1_000_000).optional(),
        opensAt: z.string().datetime().optional(),
        closesAt: z.string().datetime().optional(),
        closedMessage: longText.optional(),
        turnstile: z.boolean().optional(),
        retentionDays: z.number().int().min(1).max(3650).optional(),
        /** Keep the lead's message as a contact note. */
        saveMessageAsNote: z.boolean().optional(),
      })
      .strict()
      .default({}),

    /** Live-chat mode of the support button. */
    chat: z
      .object({
        /** First line the visitor sees, e.g. "Hello, how can I help you?" */
        greeting: shortText.optional(),
        /** Shown instead of the greeting while nobody can answer. */
        offlineText: shortText.optional(),
        showOnlineBadge: z.boolean().default(true),
        /** 'auto': Online only while an agent (human or AI) can answer; 'always': always Online. */
        onlineMode: z.enum(['auto', 'always']).default('auto'),
        /** Show typing dots before the bot-style reply that asks for details. */
        showTyping: z.boolean().default(true),
        /** Let the visitor skip the details card and start the chat with just their message. */
        allowSkip: z.boolean().default(false),
      })
      .strict()
      .optional(),

    /** Support button only. */
    widget: z
      .object({
        corner: z.enum(['bottom-left', 'bottom-right']).default('bottom-left'),
        offsetX: z.number().int().min(0).max(400).default(20),
        offsetY: z.number().int().min(0).max(400).default(20),
        label: shortText.optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        icon: z.enum(['whatsapp', 'chat', 'headset']).default('whatsapp'),
        /** 'whatsapp' opens WhatsApp after the pre-chat form; 'live_chat' starts a real-time website chat. */
        mode: z.enum(['whatsapp', 'live_chat']).default('whatsapp'),
        greeting: shortText.optional(),
        animation: z.enum(['none', 'pulse', 'bounce', 'wiggle', 'ring']).default('pulse'),
        sound: z.enum(['none', 'chime', 'pop']).default('none'),
        /** Teaser bubble above the button, and how long to wait before showing it. */
        preMessage: shortText.optional(),
        preMessageDelay: z.number().int().min(0).max(120).default(4),
        /** 'session' = once per visit (browser tab session); 'always' = on every page load. */
        preMessageRepeat: z.enum(['session', 'always']).default('session'),
        showOn: z.enum(['all', 'contains']).default('all'),
        urlContains: shortText.optional(),
        devices: z.enum(['all', 'mobile', 'desktop']).default('all'),
        hours: z
          .object({
            enabled: z.boolean().default(false),
            days: z.array(z.number().int().min(0).max(6)).max(7).default([1, 2, 3, 4, 5]),
            from: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
            to: z.string().regex(/^\d{2}:\d{2}$/).default('17:00'),
            offlineText: shortText.optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),

    pipeline: z
      .object({ pipelineId: z.string().uuid(), stageId: z.string().uuid() })
      .strict()
      .optional(),
    welcomeTemplate: z
      .object({ name: z.string().max(200), language: z.string().max(20), params: z.array(z.string().max(200)).max(10).optional() })
      .strict()
      .optional(),
    whatsappConfigId: z.string().uuid().optional(),
    /** Number custom field that stores the lead score. */
    scoreFieldId: z.string().uuid().optional(),
  })
  .strict()
export type FormSettings = z.infer<typeof formSettingsSchema>

/** Structure only. Used to read stored rows, so an old or half-edited form never fails to load. */
const formFieldsBaseSchema = z.array(formFieldSchema).max(MAX_FORM_FIELDS)

/** For writes (API, import): also checks that conditions point at earlier, testable fields. */
export const formFieldsSchema = formFieldsBaseSchema.superRefine((fields, ctx) => {
  const problem = findConditionProblem(fields)
  if (problem) ctx.addIssue({ code: 'custom', path: [problem.index, 'visibleWhen'], message: problem.message })
})

/** Parse stored JSON defensively (older rows / partial edits). */
export function parseFormSettings(raw: unknown): FormSettings {
  const r = formSettingsSchema.safeParse(raw ?? {})
  return r.success ? r.data : formSettingsSchema.parse({})
}

export function parseFormFields(raw: unknown): FormField[] {
  const r = formFieldsBaseSchema.safeParse(raw ?? [])
  return r.success ? r.data : []
}

/** A forms row as the server reads it. */
export interface FormRow {
  id: string
  account_id: string
  public_id: string
  kind: FormKind
  name: string
  status: FormStatus
  fields: unknown
  settings: unknown
  version: number
  rr_cursor: number
  archived_at: string | null
}

/** What a public visitor sends. */
export const submitPayloadSchema = z
  .object({
    /** field id -> raw answer (string | string[] | boolean). */
    answers: z.record(z.string(), z.union([z.string().max(5000), z.array(z.string().max(200)).max(MAX_OPTIONS), z.boolean(), z.number()])).default({}),
    /** Honeypot: must stay empty. */
    website: z.string().max(200).optional(),
    /** Milliseconds between form render and submit (time trap). */
    elapsedMs: z.number().int().min(0).max(24 * 3600 * 1000).optional(),
    visitorId: z.string().trim().min(8).max(64).optional(),
    /** Client-side idempotency key (double-click). */
    key: z.string().trim().min(8).max(64).optional(),
    utm: z.record(z.string(), z.string().max(300)).default({}),
    clickIds: z.record(z.string(), z.string().max(300)).default({}),
    referrer: z.string().max(1000).optional(),
    pageUrl: z.string().max(1000).optional(),
    turnstileToken: z.string().max(4000).optional(),
    test: z.boolean().optional(),
  })
  .strict()
export type SubmitPayload = z.infer<typeof submitPayloadSchema>

export const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const
