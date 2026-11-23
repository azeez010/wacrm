// ============================================================
// Export / import a form as JSON.
//
// A form points at things that belong to ONE account (tags, custom fields, pipelines, team
// members, WhatsApp numbers). The export carries NAMES for the ones that can be matched
// (tags by name, custom fields by key, pipelines and stages by name); import matches them
// in the target account and quietly drops what it can't, with a warning each. Team members
// and WhatsApp numbers never travel. Imports always land as a DRAFT.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { assertFeature } from '@/lib/billing/entitlements'
import { FORM_COLUMNS } from './public-config'
import { assertCanCreateForm, FormError, publicId, usesAdvancedFeatures } from './server'
import { formFieldsSchema, formSettingsSchema, type FormField, type FormRow } from './types'

export const FORM_DOC_FORMAT = 'ogadesk-form'
export const FORM_DOC_VERSION = 1

export interface FormDoc {
  format: typeof FORM_DOC_FORMAT
  version: typeof FORM_DOC_VERSION
  exported_at: string
  kind: 'lead' | 'support'
  name: string
  fields: unknown[]
  settings: Record<string, unknown>
  /** Names for the ids used inside fields/settings, so another account can match them. */
  refs: {
    tags: Record<string, string>
    fields: Record<string, { key: string; name: string }>
    pipelines: Record<string, { name: string; stages: Record<string, string> }>
  }
}

type Settings = Record<string, unknown>

/** Every account-specific id a form uses, by type. */
export function usedRefs(fields: FormField[], settings: Settings) {
  const tags = new Set<string>()
  const customFields = new Set<string>()
  for (const f of fields) {
    if (f.kind === 'tag_picker') for (const id of f.tagIds ?? []) tags.add(id)
    if (f.kind === 'custom_field' && f.customFieldId) customFields.add(f.customFieldId)
    if (f.kind === 'table_column' && f.tableRef?.fieldId) customFields.add(f.tableRef.fieldId)
    if (f.kind === 'hidden' && f.targetField?.startsWith('cf:')) customFields.add(f.targetField.slice(3))
  }
  if (typeof settings.scoreFieldId === 'string') customFields.add(settings.scoreFieldId)
  const p = settings.pipeline as { pipelineId?: string; stageId?: string } | undefined
  return { tags: [...tags], customFields: [...customFields], pipelineId: p?.pipelineId, stageId: p?.stageId }
}

export function buildFormDoc(
  form: Pick<FormRow, 'kind' | 'name' | 'fields' | 'settings'>,
  names: {
    tags: Map<string, string>
    fields: Map<string, { key: string; name: string }>
    pipelines: Map<string, { name: string; stages: Map<string, string> }>
  },
  now: Date = new Date(),
): FormDoc {
  const fields = (form.fields ?? []) as FormField[]
  const settings = (form.settings ?? {}) as Settings
  const used = usedRefs(fields, settings)
  const refs: FormDoc['refs'] = { tags: {}, fields: {}, pipelines: {} }
  for (const id of used.tags) if (names.tags.has(id)) refs.tags[id] = names.tags.get(id)!
  for (const id of used.customFields) if (names.fields.has(id)) refs.fields[id] = names.fields.get(id)!
  if (used.pipelineId && names.pipelines.has(used.pipelineId)) {
    const p = names.pipelines.get(used.pipelineId)!
    refs.pipelines[used.pipelineId] = { name: p.name, stages: Object.fromEntries(p.stages) }
  }
  return { format: FORM_DOC_FORMAT, version: FORM_DOC_VERSION, exported_at: now.toISOString(), kind: form.kind, name: form.name, fields: fields as unknown[], settings, refs }
}

export interface TargetNames {
  tagIdByName: Map<string, string>
  fieldIdByKey: Map<string, string>
  pipelineByName: Map<string, { id: string; stageIdByName: Map<string, string> }>
}

const lower = (s: string) => s.trim().toLowerCase()

/** Rewrite a document's ids for the target account. Pure. */
export function resolveFormDoc(doc: FormDoc, target: TargetNames): { fields: FormField[]; settings: Settings; warnings: string[] } {
  const warnings: string[] = []
  const tagId = (old: string): string | undefined => {
    const name = doc.refs?.tags?.[old]
    const id = name ? target.tagIdByName.get(lower(name)) : undefined
    if (!id) warnings.push(`Tag "${name ?? old}" was not found here and was skipped.`)
    return id
  }
  const fieldId = (old: string): string | undefined => {
    const ref = doc.refs?.fields?.[old]
    const id = ref ? target.fieldIdByKey.get(ref.key) : undefined
    if (!id) warnings.push(`Custom field "${ref?.name ?? old}" was not found here and was skipped.`)
    return id
  }

  const fields: FormField[] = []
  for (const f of (doc.fields ?? []) as FormField[]) {
    const out: FormField = { ...f }
    if (out.kind === 'tag_picker') out.tagIds = (out.tagIds ?? []).map(tagId).filter((x): x is string => !!x)
    if (out.kind === 'custom_field') {
      const id = out.customFieldId ? fieldId(out.customFieldId) : undefined
      if (!id) continue
      out.customFieldId = id
    }
    if (out.kind === 'table_column') {
      const id = out.tableRef?.fieldId ? fieldId(out.tableRef.fieldId) : undefined
      if (!id || !out.tableRef) continue
      out.tableRef = { ...out.tableRef, fieldId: id }
    }
    if (out.kind === 'hidden' && out.targetField?.startsWith('cf:')) {
      const id = fieldId(out.targetField.slice(3))
      out.targetField = id ? `cf:${id}` : undefined
    }
    fields.push(out)
  }

  const settings: Settings = JSON.parse(JSON.stringify(doc.settings ?? {}))
  if (typeof settings.scoreFieldId === 'string') {
    const id = fieldId(settings.scoreFieldId)
    if (id) settings.scoreFieldId = id
    else delete settings.scoreFieldId
  }
  const pl = settings.pipeline as { pipelineId?: string; stageId?: string } | undefined
  if (pl?.pipelineId) {
    const ref = doc.refs?.pipelines?.[pl.pipelineId]
    const found = ref ? target.pipelineByName.get(lower(ref.name)) : undefined
    const stageName = ref && pl.stageId ? ref.stages[pl.stageId] : undefined
    const stageId = stageName ? found?.stageIdByName.get(lower(stageName)) : undefined
    if (found && stageId) settings.pipeline = { pipelineId: found.id, stageId }
    else {
      delete settings.pipeline
      warnings.push(`Pipeline "${ref?.name ?? pl.pipelineId}"${stageName ? ` / ${stageName}` : ''} was not found here, so new leads will not create a deal.`)
    }
  }
  const assignment = settings.assignment as { mode?: string; agentIds?: string[] } | undefined
  if (assignment && assignment.mode && assignment.mode !== 'none') {
    settings.assignment = { mode: 'none' }
    warnings.push('Lead assignment was cleared: team members are not carried between accounts.')
  }
  const notify = settings.notify as { mode?: string } | undefined
  if (notify?.mode === 'selected') {
    settings.notify = { mode: 'all' }
    warnings.push('Notifications were reset to the whole team.')
  }
  if (settings.whatsappConfigId !== undefined) {
    delete settings.whatsappConfigId
    warnings.push('The WhatsApp number choice was dropped (it uses your default number).')
  }
  return { fields, settings, warnings }
}

/** Basic shape check of an uploaded document. */
export function parseFormDoc(raw: unknown): FormDoc {
  const d = raw as Partial<FormDoc> | null
  if (!d || typeof d !== 'object' || d.format !== FORM_DOC_FORMAT) throw new FormError('This is not an OgaDesk form file', 400)
  if (d.version !== FORM_DOC_VERSION) throw new FormError('This form file is from a newer version', 400)
  if (d.kind !== 'lead' && d.kind !== 'support') throw new FormError('Unknown form kind', 400)
  if (!Array.isArray(d.fields)) throw new FormError('The form file has no fields', 400)
  return { ...(d as FormDoc), name: String(d.name ?? 'Imported form').slice(0, 120), settings: (d.settings ?? {}) as Settings, refs: d.refs ?? { tags: {}, fields: {}, pipelines: {} } }
}

// ---------------- I/O ----------------

export async function exportForm(db: SupabaseClient, form: FormRow): Promise<FormDoc> {
  const used = usedRefs((form.fields ?? []) as FormField[], (form.settings ?? {}) as Settings)
  const tags = new Map<string, string>()
  const fields = new Map<string, { key: string; name: string }>()
  const pipelines = new Map<string, { name: string; stages: Map<string, string> }>()
  if (used.tags.length > 0) {
    const { data } = await db.from('tags').select('id, name').eq('account_id', form.account_id).in('id', used.tags)
    for (const t of (data ?? []) as { id: string; name: string }[]) tags.set(t.id, t.name)
  }
  if (used.customFields.length > 0) {
    const { data } = await db.from('custom_fields').select('id, key, field_name').eq('account_id', form.account_id).in('id', used.customFields)
    for (const f of (data ?? []) as { id: string; key: string; field_name: string }[]) fields.set(f.id, { key: f.key, name: f.field_name })
  }
  if (used.pipelineId) {
    const { data } = await db.from('pipelines').select('id, name, pipeline_stages(id, name)').eq('account_id', form.account_id).eq('id', used.pipelineId).maybeSingle()
    const p = data as { id: string; name: string; pipeline_stages?: { id: string; name: string }[] } | null
    if (p) pipelines.set(p.id, { name: p.name, stages: new Map((p.pipeline_stages ?? []).map((s) => [s.id, s.name])) })
  }
  return buildFormDoc(form, { tags, fields, pipelines })
}

export async function importForm(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  rawDoc: unknown,
): Promise<{ form: FormRow; warnings: string[] }> {
  const doc = parseFormDoc(rawDoc)
  await assertCanCreateForm(db, accountId)

  const [{ data: tags }, { data: fieldRows }, { data: pipes }] = await Promise.all([
    db.from('tags').select('id, name').eq('account_id', accountId),
    db.from('custom_fields').select('id, key').eq('account_id', accountId).is('archived_at', null),
    db.from('pipelines').select('id, name, pipeline_stages(id, name)').eq('account_id', accountId),
  ])
  const target: TargetNames = {
    tagIdByName: new Map(((tags ?? []) as { id: string; name: string }[]).map((t) => [lower(t.name), t.id])),
    fieldIdByKey: new Map(((fieldRows ?? []) as { id: string; key: string }[]).map((f) => [f.key, f.id])),
    pipelineByName: new Map(
      ((pipes ?? []) as { id: string; name: string; pipeline_stages?: { id: string; name: string }[] }[]).map((p) => [
        lower(p.name),
        { id: p.id, stageIdByName: new Map((p.pipeline_stages ?? []).map((s) => [lower(s.name), s.id])) },
      ]),
    ),
  }
  const resolved = resolveFormDoc(doc, target)

  const f = formFieldsSchema.safeParse(resolved.fields)
  if (!f.success) throw new FormError('The form file has invalid fields', 400)
  if (!f.data.some((x) => x.kind === 'phone')) throw new FormError('A form needs a phone field', 400)
  const s = formSettingsSchema.safeParse(resolved.settings)
  if (!s.success) throw new FormError('The form file has invalid settings', 400)

  // Advanced settings need the plan; rather than refuse the whole file, import without them.
  let settings = s.data
  const warnings = [...resolved.warnings]
  if (usesAdvancedFeatures(settings as never)) {
    const ok = await assertFeature(db, accountId, 'forms_advanced').then(() => true, () => false)
    if (!ok) {
      settings = { ...settings, qualification: { enabled: false, threshold: 0, onUnqualified: 'save' }, assignment: { mode: 'none' }, pipeline: undefined, welcomeTemplate: undefined, hideBranding: undefined }
      warnings.push('Scoring, round-robin, deal creation, the welcome message and badge hiding need a higher plan and were left out.')
    }
  }

  const { data, error } = await db
    .from('forms')
    .insert({ account_id: accountId, public_id: publicId(), kind: doc.kind, name: `${doc.name}`.slice(0, 120), status: 'draft', fields: f.data, settings, created_by: userId })
    .select(FORM_COLUMNS)
    .single()
  if (error || !data) throw new FormError(error?.message ?? 'Could not import the form', 500)
  return { form: data as FormRow, warnings }
}
