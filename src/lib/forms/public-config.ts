import { BRANDING_DEFAULTS, type BackgroundFit, type BackgroundOverlay, type BackgroundPosition, type LogoAlign, type LogoSize } from '@/lib/forms/branding'
import type { SupabaseClient } from '@supabase/supabase-js'

import { assertFeature } from '@/lib/billing/entitlements'
import type { VisibleWhen } from './conditions'
import { loadFormDefinitions } from './definitions'
import { parseFormFields, parseFormSettings, type FormKind, type FormRow } from './types'

// ============================================================
// What a public visitor's browser is allowed to know about a form. Built on the
// server from the stored definition; internal ids (agents, pipeline, template,
// custom field ids) never leave it.
// ============================================================

export interface PublicField {
  id: string
  kind: string
  label: string
  help?: string
  placeholder?: string
  required?: boolean
  /** custom field / table column input type (text, number, enum, ...) */
  type?: string
  options?: string[]
  display?: 'select' | 'radio' | 'chips'
  tags?: { id: string; name: string }[]
  param?: string
  fixedValue?: string
  consentText?: string
  privacyUrl?: string
  text?: string
  /** Show only when these rules hold (see lib/forms/conditions.ts). */
  visibleWhen?: VisibleWhen
}

export interface PublicFormConfig {
  publicId: string
  kind: FormKind
  name: string
  title: string
  description?: string
  buttonText?: string
  accent: string
  logoUrl?: string
  backgroundImage?: string
  logoAlign: LogoAlign
  logoSize: LogoSize
  backgroundFit: BackgroundFit
  backgroundPosition: BackgroundPosition
  backgroundOverlay: BackgroundOverlay
  language: string
  theme: 'auto' | 'light' | 'dark'
  /** ISO code, or 'auto' = use the visitor's country. */
  defaultCountry: string
  noindex: boolean
  og: { title?: string; description?: string; image?: string }
  success: {
    action: 'message' | 'redirect' | 'whatsapp'
    message?: string
    redirectUrl?: string
    followUpLine?: boolean
  }
  turnstile: boolean
  /** Show the "Powered by" line (hidden on plans with forms_advanced). */
  showBranding: boolean
  /** Account time zone, for the support button's business hours. */
  timezone?: string
  /** Live-chat wording (only meaningful when widget.mode is 'live_chat'). */
  chat?: { greeting?: string; offlineText?: string; showOnlineBadge: boolean }
  widget?: {
    corner: 'bottom-left' | 'bottom-right'
    offsetX: number
    offsetY: number
    label?: string
    color?: string
    icon: 'whatsapp' | 'chat' | 'headset'
    /** 'whatsapp' opens WhatsApp after the pre-chat form; 'live_chat' starts a real-time chat. */
    mode: 'whatsapp' | 'live_chat'
    greeting?: string
    animation: 'none' | 'pulse' | 'bounce' | 'wiggle' | 'ring'
    sound: 'none' | 'chime' | 'pop'
    preMessage?: string
    preMessageDelay: number
    preMessageRepeat: 'session' | 'always'
    showOn: 'all' | 'contains'
    urlContains?: string
    devices: 'all' | 'mobile' | 'desktop'
    hours?: { enabled: boolean; days: number[]; from: string; to: string; offlineText?: string }
  }
  fields: PublicField[]
}

export const FORM_COLUMNS =
  'id, account_id, public_id, kind, name, status, fields, settings, version, rr_cursor, archived_at'

/** The row for a public id, or null (also null for archived forms). */
export async function loadFormByPublicId(db: SupabaseClient, publicId: string): Promise<FormRow | null> {
  if (!/^[a-z0-9]{6,32}$/i.test(publicId)) return null
  const { data } = await db.from('forms').select(FORM_COLUMNS).eq('public_id', publicId).maybeSingle()
  const row = data as FormRow | null
  if (!row || row.archived_at) return null
  return row
}

export async function buildPublicConfig(db: SupabaseClient, form: FormRow): Promise<PublicFormConfig> {
  const settings = parseFormSettings(form.settings)
  const fields = parseFormFields(form.fields)
  const defs = await loadFormDefinitions(db, form.account_id, fields)

  const tagIds = [...new Set(fields.flatMap((f) => (f.kind === 'tag_picker' ? f.tagIds ?? [] : [])))]
  const tagNames = new Map<string, string>()
  if (tagIds.length > 0) {
    const { data } = await db.from('tags').select('id, name').eq('account_id', form.account_id).in('id', tagIds)
    for (const t of (data ?? []) as { id: string; name: string }[]) tagNames.set(t.id, t.name)
  }

  const pub: PublicField[] = []
  for (const f of fields) {
    const base: PublicField = {
      id: f.id,
      kind: f.kind,
      label: f.label ?? '',
      help: f.help,
      placeholder: f.placeholder,
      required: f.kind === 'phone' ? true : f.required,
      visibleWhen: f.visibleWhen,
    }
    if (f.kind === 'custom_field') {
      const d = f.customFieldId ? defs.customFields.get(f.customFieldId) : undefined
      if (!d) continue
      base.type = d.field_type
      base.label = f.label || d.field_name
      base.options = f.options?.length ? f.options : d.field_options?.options
      base.display = f.display
    } else if (f.kind === 'table_column') {
      const d = f.tableRef ? defs.tableColumns.get(`${f.tableRef.fieldId}:${f.tableRef.columnKey}`) : undefined
      if (!d) continue
      base.type = d.field_type
      base.label = f.label || d.field_name
      base.options = f.options?.length ? f.options : d.field_options?.options
      base.display = f.display
    } else if (f.kind === 'tag_picker') {
      base.tags = (f.tagIds ?? []).flatMap((id) => (tagNames.has(id) ? [{ id, name: tagNames.get(id) as string }] : []))
    } else if (f.kind === 'hidden') {
      base.param = f.param
      base.fixedValue = f.fixedValue
    } else if (f.kind === 'consent') {
      base.consentText = f.consentText
      base.privacyUrl = f.privacyUrl
    } else if (f.kind === 'heading') {
      base.text = f.text
    }
    pub.push(base)
  }

  const { data: acct } = await db.from('accounts').select('timezone').eq('id', form.account_id).maybeSingle()
  // The badge is on by default; only plans with forms_advanced may switch it off.
  const advanced = await assertFeature(db, form.account_id, 'forms_advanced').then(
    () => true,
    () => false,
  )
  const branded = !(settings.hideBranding === true && advanced)
  const w = settings.widget
  return {
    publicId: form.public_id,
    kind: form.kind,
    name: form.name,
    title: settings.title ?? form.name,
    description: settings.description,
    buttonText: settings.buttonText,
    accent: settings.accent ?? '#10b981',
    logoUrl: settings.logoUrl,
    backgroundImage: settings.backgroundImage,
    logoAlign: settings.logoAlign ?? BRANDING_DEFAULTS.logoAlign,
    logoSize: settings.logoSize ?? BRANDING_DEFAULTS.logoSize,
    backgroundFit: settings.backgroundFit ?? BRANDING_DEFAULTS.backgroundFit,
    backgroundPosition: settings.backgroundPosition ?? BRANDING_DEFAULTS.backgroundPosition,
    backgroundOverlay: settings.backgroundOverlay ?? BRANDING_DEFAULTS.backgroundOverlay,
    language: settings.language ?? 'en',
    theme: settings.theme ?? 'auto',
    defaultCountry: (settings.defaultCountry ?? 'auto').toLowerCase() === 'auto' ? 'auto' : (settings.defaultCountry as string).toUpperCase(),
    noindex: settings.noindex !== false,
    og: { title: settings.ogTitle, description: settings.ogDescription, image: settings.ogImage },
    success: {
      action: settings.success.action,
      message: settings.success.message,
      redirectUrl: settings.success.action === 'redirect' ? settings.success.redirectUrl : undefined,
      followUpLine: settings.success.followUpLine,
    },
    showBranding: branded,
    timezone: (acct as { timezone?: string } | null)?.timezone ?? 'UTC',
    turnstile: !!settings.rules.turnstile && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    widget:
      form.kind === 'support' && w
        ? {
            corner: w.corner,
            offsetX: w.offsetX,
            offsetY: w.offsetY,
            label: w.label,
            color: w.color ?? settings.accent,
            icon: w.icon,
            mode: w.mode,
            greeting: w.greeting,
            animation: w.animation,
            sound: w.sound,
            preMessage: w.preMessage,
            preMessageDelay: w.preMessageDelay,
            preMessageRepeat: w.preMessageRepeat,
            showOn: w.showOn,
            urlContains: w.urlContains,
            devices: w.devices,
            hours: w.hours,
          }
        : form.kind === 'support'
          ? { corner: 'bottom-left', offsetX: 20, offsetY: 20, icon: 'whatsapp', mode: 'whatsapp', animation: 'pulse', sound: 'none', preMessageDelay: 4, preMessageRepeat: 'session', showOn: 'all', devices: 'all', color: settings.accent }
          : undefined,
    chat:
      form.kind === 'support' && w?.mode === 'live_chat'
        ? { greeting: settings.chat?.greeting, offlineText: settings.chat?.offlineText, showOnlineBadge: settings.chat?.showOnlineBadge !== false }
        : undefined,
    fields: pub,
  }
}
