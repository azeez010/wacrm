import type { SupabaseClient } from '@supabase/supabase-js'

import { assertFeature, assertWithinLimit } from '@/lib/billing/entitlements'
import { FORM_COLUMNS } from './public-config'
import { getFormTemplate } from './templates'
import { formFieldsSchema, formSettingsSchema, parseFormSettings, type FormRow } from './types'

export class FormError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'FormError'
  }
}

/** Unguessable, non-secret id for public URLs: 16 hex characters (64 bits). */
export function publicId(): string {
  const a = new Uint8Array(8)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Throws when creating one more form would exceed the plan. Archived forms do not count. */
export async function assertCanCreateForm(db: SupabaseClient, accountId: string): Promise<void> {
  await assertFeature(db, accountId, 'forms')
  const { count } = await db
    .from('forms')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .is('archived_at', null)
  await assertWithinLimit(db, accountId, 'forms_max', count ?? 0)
}

export async function createFormFromTemplate(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  input: { template: string; name?: string },
): Promise<FormRow> {
  const tpl = getFormTemplate(input.template)
  if (!tpl) throw new FormError('Unknown template', 400)
  await assertCanCreateForm(db, accountId)
  const name = (input.name ?? '').trim() || tpl.name
  const { data, error } = await db
    .from('forms')
    .insert({
      account_id: accountId,
      public_id: publicId(),
      kind: tpl.kind,
      name: name.slice(0, 120),
      status: 'draft',
      fields: tpl.fields,
      settings: tpl.settings,
      created_by: userId,
    })
    .select(FORM_COLUMNS)
    .single()
  if (error || !data) throw new FormError(error?.message ?? 'Could not create the form', 500)
  return data as FormRow
}

/** Settings that need the `forms_advanced` plan feature. */
export function usesAdvancedFeatures(settings: { qualification?: { enabled?: boolean }; assignment?: { mode?: string }; pipeline?: unknown; welcomeTemplate?: unknown; hideBranding?: boolean } | undefined): boolean {
  if (!settings) return false
  return !!settings.qualification?.enabled || settings.assignment?.mode === 'round_robin' || !!settings.pipeline || !!settings.welcomeTemplate || settings.hideBranding === true
}

export interface FormPatch {
  name?: string
  status?: 'draft' | 'active' | 'paused'
  fields?: unknown
  settings?: unknown
}

/** Validate an edit and build the update. Phone must stay on the form. */
export function buildFormUpdate(current: Pick<FormRow, 'version' | 'fields'> & Partial<Pick<FormRow, 'settings'>>, patch: FormPatch): Record<string, unknown> {
  const update: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    const n = String(patch.name).trim()
    if (!n) throw new FormError('Name is required', 400)
    update.name = n.slice(0, 120)
  }
  if (patch.status !== undefined) {
    if (!['draft', 'active', 'paused'].includes(patch.status)) throw new FormError('Invalid status', 400)
    update.status = patch.status
  }
  if (patch.settings !== undefined) {
    const s = formSettingsSchema.safeParse(patch.settings)
    if (!s.success) throw new FormError('Invalid settings', 400)
    update.settings = s.data
  }
  if (patch.fields !== undefined) {
    const f = formFieldsSchema.safeParse(patch.fields)
    if (!f.success) throw new FormError('Invalid fields', 400)
    // A live-chat widget may skip the phone: the visitor is identified by the chat itself.
    const liveChat = (patch.settings !== undefined ? parseFormSettings(patch.settings) : parseFormSettings(current.settings ?? {})).widget?.mode === 'live_chat'
    if (!liveChat && !f.data.some((x) => x.kind === 'phone')) throw new FormError('A form needs a phone field', 400)
    const ids = new Set<string>()
    for (const x of f.data) {
      if (ids.has(x.id)) throw new FormError('Duplicate field id', 400)
      ids.add(x.id)
    }
    update.fields = f.data
    // Edited fields = a new version, so old submissions keep their own labels.
    if (JSON.stringify(f.data) !== JSON.stringify(current.fields)) update.version = current.version + 1
  }
  return update
}
