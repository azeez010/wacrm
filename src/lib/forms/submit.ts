import type { SupabaseClient } from '@supabase/supabase-js'

import { addContactTags, findOrCreateContact, resolveAuditUserId } from '@/lib/api/v1/contacts'
import { assertFeature, getLimit } from '@/lib/billing/entitlements'
import { monthStartUtc } from '@/lib/billing/usage'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events'
import { firstTouchPatch, utmToColumns } from '@/lib/contacts/lead-source'
import { writeContactCustomFields } from '@/lib/custom-fields/contact-values'
import { bulkResolveRecords } from '@/lib/custom-fields/server'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { assertFeature as assertPlanFeature } from '@/lib/billing/entitlements'
import { assertMessageQuota } from '@/lib/billing/usage'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import { sendMessageToConversation } from '@/lib/whatsapp/send-message'

import { loadFormDefinitions, type FormDefinitions } from './definitions'
import { scoreAnswers } from './scoring'
import {
  parseFormFields,
  parseFormSettings,
  submitPayloadSchema,
  type FormRow,
  type FormSettings,
  type SubmitPayload,
} from './types'
import { validateAnswers, type ValidatedAnswers } from './validate-answers'

// ============================================================
// The one pipeline behind every form submission (public page, embed, widget,
// headless endpoint, API). Two phases:
//
//  1. submitForm()  - synchronous, decides what the visitor sees: validates,
//     scores, applies rules/quota, and WRITES THE SUBMISSION ROW FIRST so a
//     lead is never lost.
//  2. outcome.finish() - side effects (contact, tags, notes, assignment,
//     notification...). Run it in `after()`. Every step records its own result
//     in form_submissions.processing so a failed step can be retried.
// ============================================================

export interface SubmitMeta {
  ipHash?: string | null
  country?: string | null
  device?: string | null
  /** 'public' (anonymous visitor) or 'api' (API key). */
  source?: 'public' | 'api'
  /** Only set by authenticated preview/test calls. */
  isTest?: boolean
  now?: Date
}

export interface SuccessInfo {
  action: 'message' | 'redirect' | 'whatsapp'
  message?: string
  redirectUrl?: string
  /** whatsapp: wa.me link (null when the business number is unknown). */
  whatsappUrl?: string | null
  followUpLine?: boolean
}

export type SubmitResult =
  | { status: 'ok'; qualified: boolean; held: boolean; success: SuccessInfo }
  | { status: 'invalid'; errors: Record<string, string> }
  | { status: 'closed'; message: string }
  | { status: 'gated'; message: string }
  | { status: 'unavailable' }
  | { status: 'not_found' }

export interface SubmitOutcome {
  result: SubmitResult
  /** Side effects; call inside `after()`. */
  finish?: () => Promise<void>
}

const OK_IGNORED: SubmitResult = {
  status: 'ok',
  qualified: true,
  held: false,
  success: { action: 'message' },
}

type Db = SupabaseClient

/** Whether the form accepts submissions right now. Pure. */
export function openState(
  form: Pick<FormRow, 'status' | 'archived_at'>,
  settings: FormSettings,
  now: Date,
): { open: true } | { open: false; reason: 'not_found' | 'unavailable' | 'closed' } {
  if (form.archived_at) return { open: false, reason: 'not_found' }
  if (form.status !== 'active') return { open: false, reason: 'unavailable' }
  const { opensAt, closesAt } = settings.rules
  if (opensAt && now < new Date(opensAt)) return { open: false, reason: 'closed' }
  if (closesAt && now >= new Date(closesAt)) return { open: false, reason: 'closed' }
  return { open: true }
}

/** Fill {{name}}, {{message}} and {{field_key}} in the prefilled WhatsApp text. Pure. */
export function renderWhatsappText(
  template: string | undefined,
  vars: Record<string, string | undefined>,
): string {
  const t = template && template.trim() ? template : 'Hi, I just filled in your form.'
  return t
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => (vars[k] ?? '').trim())
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function buildWhatsappUrl(displayPhone: string | null | undefined, text: string): string | null {
  const digits = (displayPhone ?? '').replace(/\D/g, '')
  if (!digits) return null
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

interface Prechecked {
  existingContact: Record<string, unknown> | null
}

export async function submitForm(
  db: Db,
  form: FormRow,
  rawPayload: unknown,
  meta: SubmitMeta = {},
): Promise<SubmitOutcome> {
  const now = meta.now ?? new Date()
  const parsedPayload = submitPayloadSchema.safeParse(rawPayload)
  if (!parsedPayload.success) return { result: { status: 'invalid', errors: { _form: 'bad_request' } } }
  const payload: SubmitPayload = parsedPayload.data

  const settings = parseFormSettings(form.settings)
  const fields = parseFormFields(form.fields)
  const isTest = !!meta.isTest || (meta.source === 'api' ? false : false)

  const state = openState(form, settings, now)
  if (!state.open) {
    if (state.reason === 'not_found') return { result: { status: 'not_found' } }
    if (state.reason === 'closed') {
      return { result: { status: 'closed', message: settings.rules.closedMessage ?? '' } }
    }
    return { result: { status: 'unavailable' } }
  }

  try {
    await assertFeature(db, form.account_id, 'forms')
  } catch {
    return { result: { status: 'unavailable' } }
  }

  const base = {
    form_id: form.id,
    account_id: form.account_id,
    form_version: form.version,
    is_test: isTest,
    utm: payload.utm,
    click_ids: payload.clickIds,
    referrer: payload.referrer ?? null,
    page_url: payload.pageUrl ?? null,
    country: meta.country ?? null,
    device: meta.device ?? null,
    visitor_id: payload.visitorId ?? null,
    ip_hash: meta.ipHash ?? null,
  }

  // Bots: a filled honeypot or an impossibly fast submit. Looks successful to the
  // bot, is stored as rejected (visible to the owner), and does nothing else.
  const tooFast = meta.source !== 'api' && payload.elapsedMs !== undefined && payload.elapsedMs < 1200
  if ((payload.website && payload.website.trim() !== '') || tooFast) {
    await db.from('form_submissions').insert({
      ...base,
      outcome: 'rejected',
      reject_reason: payload.website ? 'honeypot' : 'too_fast',
      answers: {},
    })
    return { result: OK_IGNORED }
  }

  // Double-click / retry: same client key already stored -> same answer, no second lead.
  if (payload.key) {
    const { data: dup } = await db
      .from('form_submissions')
      .select('id')
      .eq('form_id', form.id)
      .filter('processing->>key', 'eq', payload.key)
      .limit(1)
    if (dup && dup.length > 0) {
      return { result: { status: 'ok', qualified: true, held: false, success: successInfo(settings, null, {}, '') } }
    }
  }

  const defs = await loadFormDefinitions(db, form.account_id, fields)
  const v = validateAnswers(fields, payload.answers, {
    accountId: form.account_id,
    // 'auto' (or unset): the country of the request (Cloudflare), else Nigeria.
    defaultCountry: !settings.defaultCountry || settings.defaultCountry === 'auto' ? (meta.country ?? 'NG') : settings.defaultCountry,
    customFields: defs.customFields,
    tableColumns: defs.tableColumns,
    now,
  })
  if (!v.ok) return { result: { status: 'invalid', errors: v.errors } }

  const score = scoreAnswers(fields, payload.answers, settings)

  // Qualification gate: block the entry (still logged, never creates a contact).
  if (settings.qualification.enabled && !score.qualified && settings.qualification.onUnqualified === 'block') {
    await db.from('form_submissions').insert({
      ...base,
      answers: v.snapshot,
      score: score.score,
      qualified: false,
      outcome: 'blocked',
      reject_reason: 'not_qualified',
    })
    return {
      result: { status: 'gated', message: settings.qualification.blockMessage ?? '' },
    }
  }

  const pre = await precheck(db, form, settings, v, isTest)
  if (pre.reject) {
    await db.from('form_submissions').insert({
      ...base,
      answers: v.snapshot,
      outcome: 'rejected',
      reject_reason: pre.reject,
    })
    // One entry per phone: look identical to a normal success (no enumeration).
    return { result: { status: 'ok', qualified: true, held: false, success: successInfo(settings, null, v, '') } }
  }
  if (pre.capReached) return { result: { status: 'closed', message: settings.rules.closedMessage ?? '' } }

  const held = pre.held
  if (pre.unavailable) return { result: { status: 'unavailable' } }

  const { data: inserted, error: insErr } = await db
    .from('form_submissions')
    .insert({
      ...base,
      answers: v.snapshot,
      score: score.score,
      qualified: settings.qualification.enabled ? score.qualified : null,
      outcome: held ? 'held' : 'accepted',
      consent: v.consent,
      processing: payload.key ? { key: payload.key } : {},
    })
    .select('id')
    .single()
  if (insErr || !inserted) return { result: { status: 'unavailable' } }

  const business = await businessNumber(db, form.account_id, settings.whatsappConfigId)
  const text = renderWhatsappText(settings.success.whatsappText, {
    name: v.name,
    message: v.message,
    ...Object.fromEntries(Object.entries(v.snapshot).map(([k, s]) => [k, typeof s.value === 'string' ? s.value : ''])),
  })
  const success = successInfo(settings, buildWhatsappUrl(business, text), v, text)
  const qualified = settings.qualification.enabled ? score.qualified : true

  const result: SubmitResult = { status: 'ok', qualified, held, success }
  if (held || isTest) return { result }

  return {
    result,
    finish: async () => {
      // ~1 in 25 submissions also tidies expired rows (retention setting).
      if (Math.random() < 0.04) await purgeExpired(db, form, now).catch(() => undefined)
      return runSideEffects(db, {
        submissionId: inserted.id as string,
        form,
        settings,
        defs,
        v,
        qualified: settings.qualification.enabled ? score.qualified : null,
        payload,
        pre,
        now,
      })
    },
  }
}

function successInfo(
  settings: FormSettings,
  whatsappUrl: string | null,
  _v: Pick<ValidatedAnswers, 'name'> | Record<string, never>,
  _text: string,
): SuccessInfo {
  const s = settings.success
  return {
    action: s.action,
    message: s.message,
    redirectUrl: s.action === 'redirect' ? s.redirectUrl : undefined,
    whatsappUrl: s.action === 'whatsapp' ? whatsappUrl : undefined,
    followUpLine: s.action === 'whatsapp' ? s.followUpLine !== false : undefined,
  }
}

async function businessNumber(db: Db, accountId: string, configId?: string): Promise<string | null> {
  let q = db.from('whatsapp_config').select('display_phone_number').eq('account_id', accountId)
  if (configId) q = q.eq('id', configId)
  const { data } = await q.limit(1)
  const row = (data ?? [])[0] as { display_phone_number?: string | null } | undefined
  return row?.display_phone_number ?? null
}

interface PrecheckResult extends Prechecked {
  held: boolean
  reject?: string
  capReached?: boolean
  unavailable?: boolean
}

/** Rules that need the database: cap, one-per-phone, quota, contact limit. */
async function precheck(
  db: Db,
  form: FormRow,
  settings: FormSettings,
  v: ValidatedAnswers,
  isTest: boolean,
): Promise<PrecheckResult> {
  const out: PrecheckResult = { existingContact: null, held: false }
  if (isTest) return out

  const { maxSubmissions, onePerPhone } = settings.rules
  if (maxSubmissions) {
    const { count } = await db
      .from('form_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('form_id', form.id)
      .eq('is_test', false)
      .eq('outcome', 'accepted')
    if ((count ?? 0) >= maxSubmissions) return { ...out, capReached: true }
  }

  if (v.phone) out.existingContact = (await findExistingContact(db, form.account_id, v.phone)) as Record<string, unknown> | null

  if (onePerPhone && out.existingContact) {
    const { count } = await db
      .from('form_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('form_id', form.id)
      .eq('contact_id', out.existingContact.id as string)
      .eq('outcome', 'accepted')
    if ((count ?? 0) > 0) return { ...out, reject: 'duplicate_phone' }
  }

  // Monthly quota: over it, store as "held" (never lose the lead), up to 1x the quota.
  try {
    const { limit } = await getLimit(db, form.account_id, 'form_submissions_per_month')
    if (limit !== null) {
      const { data } = await db.rpc('count_form_submissions', {
        p_account: form.account_id,
        p_since: monthStartUtc().toISOString(),
      })
      const accepted = Number((data as { accepted?: number } | null)?.accepted ?? 0)
      const heldN = Number((data as { held?: number } | null)?.held ?? 0)
      if (accepted >= limit) {
        if (heldN >= limit) return { ...out, unavailable: true }
        out.held = true
      }
    }
    // Contact plan limit: a NEW contact over the limit is held too.
    if (!out.held && !out.existingContact) {
      const { limit: cLimit } = await getLimit(db, form.account_id, 'contacts')
      if (cLimit !== null) {
        const { count } = await db.from('contacts').select('id', { count: 'exact', head: true }).eq('account_id', form.account_id)
        if ((count ?? 0) >= cLimit) out.held = true
      }
    }
  } catch {
    // Fail open: a counter hiccup must never reject leads.
  }
  return out
}

interface FinishCtx {
  submissionId: string
  form: FormRow
  settings: FormSettings
  defs: FormDefinitions
  v: ValidatedAnswers
  qualified: boolean | null
  payload: SubmitPayload
  pre: Prechecked
  now: Date
  /** Retry only these steps (the contact step always runs). */
  only?: Set<string>
}

type StepResult = { ok: boolean; error?: string; skipped?: string }

function isEmptyCell(v: unknown): boolean {
  return v === undefined || v === null || String(v).trim() === ''
}

export async function runSideEffects(db: Db, c: FinishCtx): Promise<void> {
  const { form, settings, v, submissionId } = c
  const accountId = form.account_id
  const steps: Record<string, StepResult> = {}
  const step = async (name: string, fn: () => Promise<void | string>) => {
    if (c.only && name !== 'contact' && !c.only.has(name)) return
    try {
      const skipped = await fn()
      steps[name] = skipped ? { ok: true, skipped } : { ok: true }
    } catch (e) {
      steps[name] = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  let contactId: string | null = null
  let contactRow: Record<string, unknown> | null = c.pre.existingContact
  let created = false
  let userId = ''
  let blockedContact = false

  await step('contact', async () => {
    userId = await resolveAuditUserId(db, accountId)
    if (contactRow) {
      contactId = contactRow.id as string
      if (contactRow.blocked_at) {
        blockedContact = true
        return 'blocked'
      }
      return
    }
    const r = await findOrCreateContact(db, accountId, userId, {
      phone: v.phone as string,
      name: v.name,
      email: v.email,
      company: v.company,
      leadSource: `Form: ${form.name}`,
    })
    contactId = r.id
    created = r.created
    const { data } = await db.from('contacts').select('*').eq('id', r.id).eq('account_id', accountId).maybeSingle()
    contactRow = (data as Record<string, unknown> | null) ?? { id: r.id }
  })

  if (!contactId || steps.contact?.ok === false) {
    await persist(db, submissionId, contactId, false, steps)
    return
  }
  const cid: string = contactId
  if (blockedContact) {
    await persist(db, submissionId, cid, false, steps)
    return
  }

  // Core fields + first-touch source (empty-only: never overwrite what a customer already has).
  await step('contact_fields', async () => {
    const patch: Record<string, unknown> = {}
    const row = contactRow ?? {}
    const nameIsPhone = !isEmptyCell(row.name) && row.name === row.phone
    if (v.name && (isEmptyCell(row.name) || nameIsPhone)) patch.name = v.name
    if (v.email && isEmptyCell(row.email)) patch.email = v.email
    if (v.company && isEmptyCell(row.company)) patch.company = v.company
    Object.assign(
      patch,
      firstTouchPatch(
        row,
        {
          ...utmToColumns(c.payload.utm),
          lead_source: `Form: ${form.name}`,
          source_referrer: c.payload.referrer,
          source_form_id: form.id,
        },
        c.now,
      ),
    )
    if (v.consent && isEmptyCell(row.opt_in_at)) {
      patch.opt_in_at = v.consent.at
      patch.opt_in_source = `Form: ${form.name}`
      patch.opt_in_text = v.consent.text
    }
    if (Object.keys(patch).length === 0) return
    const { error } = await db.from('contacts').update(patch).eq('id', cid).eq('account_id', accountId)
    if (error) throw new Error(error.message)
  })

  // Custom field values: only the ones the contact does not have yet.
  await step('custom_fields', async () => {
    const entries = Object.entries(v.customByKey)
    if (entries.length === 0) return
    const idByKey = new Map([...c.defs.customFields.values()].map((f) => [f.key, f.id]))
    const { data: have } = await db
      .from('contact_custom_values')
      .select('custom_field_id, value')
      .eq('contact_id', cid)
      .in('custom_field_id', entries.map(([k]) => idByKey.get(k)).filter((x): x is string => !!x))
    const filled = new Set(((have ?? []) as { custom_field_id: string; value: string | null }[]).filter((r) => !isEmptyCell(r.value)).map((r) => r.custom_field_id))
    const toWrite = Object.fromEntries(entries.filter(([k]) => !filled.has(idByKey.get(k) ?? '')))
    if (Object.keys(toWrite).length === 0) return
    const r = await writeContactCustomFields(db, accountId, cid, toWrite)
    if (!r.ok) throw new Error(r.error)
  })

  // Custom-table rows: find/create the row, link it through the contact's reference field.
  await step('table_rows', async () => {
    for (const [refFieldId, columns] of Object.entries(v.tableRows)) {
      const ref = c.defs.refFields.get(refFieldId)
      if (!ref) continue
      const { data: have } = await db
        .from('contact_custom_values')
        .select('value')
        .eq('contact_id', cid)
        .eq('custom_field_id', refFieldId)
        .maybeSingle()
      if (!isEmptyCell((have as { value?: string } | null)?.value)) continue
      const res = await bulkResolveRecords(
        { db, accountId, userId, role: 'admin' },
        ref.tableKey,
        [columns],
        { createMissing: true },
      )
      if (!res.ok) throw new Error(res.error)
      const hit = res.data.results[0]
      if (!hit || hit.error || !hit.id) throw new Error(hit?.error ?? 'Could not resolve the table row')
      const w = await writeContactCustomFields(db, accountId, cid, { [ref.key]: hit.id })
      if (!w.ok) throw new Error(w.error)
    }
  })

  await step('tags', async () => {
    const names = [
      settings.autoTag === undefined ? slugTag(form.name) : settings.autoTag,
      ...(c.qualified === true ? settings.tagsQualified ?? [] : []),
      ...(c.qualified === false ? settings.tagsNotQualified ?? [] : []),
    ].filter((n): n is string => !!n && n.trim() !== '')
    if (names.length > 0) await addContactTags(db, accountId, userId, cid, names)
    for (const tagId of v.tagIds) await addContactTagAndDispatch({ db, accountId, contactId: cid, tagId })
  })

  await step('note', async () => {
    if (!v.message || settings.rules.saveMessageAsNote === false) return
    const { error } = await db.from('contact_notes').insert({
      account_id: accountId,
      contact_id: cid,
      user_id: userId,
      note_text: `${form.name}: ${v.message}`,
    })
    if (error) throw new Error(error.message)
  })

  // Repeat window: same contact, same form, recently -> no new notification/assignment.
  let isRepeat = false
  await step('repeat_check', async () => {
    const hours = settings.rules.repeatWindowHours ?? 24
    if (hours <= 0 || created) return
    const since = new Date(c.now.getTime() - hours * 3600_000).toISOString()
    const { count } = await db
      .from('form_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('form_id', form.id)
      .eq('contact_id', cid)
      .eq('is_test', false)
      .in('outcome', ['accepted'])
      .gte('created_at', since)
      .neq('id', submissionId)
    isRepeat = (count ?? 0) > 0
  })

  let assignedTo: string | null = null
  let conversationId: string | null = null
  if (!isRepeat) {
    // A (quiet) conversation, so assignment and automations that send messages have one.
    await step('conversation', async () => {
      try {
        const conv = await resolveConversationByPhone(db, accountId, v.phone as string, v.name ?? null, {
          quiet: true,
          whatsappConfigId: settings.whatsappConfigId ?? null,
        })
        conversationId = conv.conversationId
      } catch (e) {
        // No WhatsApp connected yet is not a failure of the lead.
        if (/whatsapp/i.test(e instanceof Error ? e.message : '')) return 'no whatsapp connection'
        throw e
      }
    })

    await step('assign', async () => {
      const a = settings.assignment
      if (a.mode === 'none' || !a.agentIds || a.agentIds.length === 0) return 'off'
      if (!conversationId) return 'no conversation'
      let agent = a.agentIds[0]
      if (a.mode === 'round_robin') {
        const cursor = form.rr_cursor
        agent = a.agentIds[cursor % a.agentIds.length]
        await db.from('forms').update({ rr_cursor: cursor + 1 }).eq('id', form.id).eq('rr_cursor', cursor)
      }
      const { error } = await db
        .from('conversations')
        .update({ assigned_agent_id: agent })
        .eq('id', conversationId)
        .eq('account_id', accountId)
        .is('assigned_agent_id', null)
      if (error) throw new Error(error.message)
      assignedTo = agent
    })

    await step('notify', async () => {
      // Default: everyone who handles leads (a new agent is never missed); optionally only chosen people. The assignee is always included.
      const { data } = await db
        .from('profiles')
        .select('user_id, account_role')
        .eq('account_id', accountId)
        .in('account_role', ['owner', 'admin', 'agent'])
      const members = ((data ?? []) as { user_id: string }[]).map((r) => r.user_id)
      const chosen = settings.notify.mode === 'selected' ? new Set(settings.notify.agentIds ?? []) : null
      const recipients = [...new Set([...(chosen ? members.filter((id) => chosen.has(id)) : members), ...(assignedTo ? [assignedTo] : [])])]
      if (recipients.length === 0) return 'no recipients'
      const label = v.name || (v.phone as string)
      const { error } = await db.from('notifications').insert(
        recipients.map((user_id) => ({
          account_id: accountId,
          user_id,
          type: 'form_submission',
          contact_id: cid,
          title: `${form.kind === 'support' ? 'New support' : 'New lead'}: ${label}`,
          body: notificationBody(form.name, v.message, c.qualified === false),
        })),
      )
      if (error) throw new Error(error.message)
    })

    // Optional deal in a pipeline stage (qualified leads only when qualification is on).
    await step('deal', async () => {
      const pl = settings.pipeline
      if (!pl) return 'off'
      if (settings.qualification.enabled && c.qualified === false) return 'not qualified'
      await assertPlanFeature(db, accountId, 'forms_advanced')
      const [{ data: stage }, { data: acct }, { data: existing }] = await Promise.all([
        db.from('pipeline_stages').select('id').eq('id', pl.stageId).eq('pipeline_id', pl.pipelineId).maybeSingle(),
        db.from('accounts').select('default_currency').eq('id', accountId).maybeSingle(),
        db.from('deals').select('id').eq('account_id', accountId).eq('contact_id', cid).eq('pipeline_id', pl.pipelineId).eq('status', 'open').limit(1),
      ])
      if (!stage) throw new Error('The pipeline stage no longer exists')
      // One open deal per contact per pipeline: a returning lead does not pile up deals.
      if ((existing ?? []).length > 0) return 'already has an open deal'
      const { error } = await db.from('deals').insert({
        account_id: accountId,
        user_id: userId,
        pipeline_id: pl.pipelineId,
        stage_id: pl.stageId,
        contact_id: cid,
        conversation_id: conversationId,
        title: `${v.name || v.phone} (${form.name})`.slice(0, 200),
        value: 0,
        currency: (acct as { default_currency?: string } | null)?.default_currency ?? 'USD',
        status: 'open',
      })
      if (error) throw new Error(error.message)
    })

    // Optional welcome template (More options). Only with consent, never to a blocked
    // contact (the send core refuses those too), and within the plan's message quota.
    await step('welcome', async () => {
      const w = settings.welcomeTemplate
      if (!w) return 'off'
      if (!v.consent) return 'no consent'
      if (!conversationId) return 'no conversation'
      await assertPlanFeature(db, accountId, 'forms_advanced')
      await assertMessageQuota(db, accountId, 1)
      const vars = answerVars(v, c.qualified, form)
      const params = (w.params ?? []).map((p) => renderWhatsappText(p, vars as Record<string, string>))
      await sendMessageToConversation(db, accountId, {
        conversationId,
        messageType: 'template',
        templateName: w.name,
        templateLanguage: w.language,
        templateParams: params,
        senderId: null,
        whatsappConfigId: settings.whatsappConfigId ?? null,
      })
    })

    // Answers as automation variables: {{vars.name}}, {{vars.<custom field key>}}, {{vars.score}}...
    const vars = answerVars(v, c.qualified, form)
    await step('automation', async () => {
      await runAutomationsForTrigger({
        accountId,
        triggerType: 'form_submitted',
        contactId: cid,
        context: { conversation_id: conversationId ?? undefined, form_id: form.id, vars },
      })
    })
    await step('webhook', async () => {
      await dispatchWebhookEvent(db, accountId, 'form.submitted', {
        form: { id: form.id, name: form.name },
        submission_id: submissionId,
        contact_id: cid,
        qualified: c.qualified,
        answers: vars,
        utm: c.payload.utm,
      })
    })
  }

  await persist(db, submissionId, cid, isRepeat, steps)
}

async function persist(
  db: Db,
  submissionId: string,
  contactId: string | null,
  isRepeat: boolean,
  steps: Record<string, StepResult>,
): Promise<void> {
  const { data: cur } = await db.from('form_submissions').select('processing').eq('id', submissionId).maybeSingle()
  const prev = ((cur as { processing?: Record<string, unknown> } | null)?.processing ?? {}) as Record<string, unknown>
  const prevSteps = (prev.steps ?? {}) as Record<string, StepResult>
  await db
    .from('form_submissions')
    .update({ contact_id: contactId, is_repeat: isRepeat, processing: { ...prev, steps: { ...prevSteps, ...steps } } })
    .eq('id', submissionId)
}

/** Default auto tag: the form name as a tag-friendly slug ("Gym join" -> "gym-join"). */
export function slugTag(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * Re-run the pipeline for a stored submission: release a held lead, or retry the
 * steps that failed. Works from the answers snapshot, so it does not need the
 * visitor's original request.
 */
export async function reprocessSubmission(
  db: Db,
  form: FormRow,
  submission: {
    id: string
    answers: Record<string, { label: string; value: unknown }>
    qualified: boolean | null
    utm: Record<string, string>
    referrer: string | null
    processing: { steps?: Record<string, StepResult> } | null
  },
  opts: { onlyFailed: boolean; now?: Date },
): Promise<void> {
  const settings = parseFormSettings(form.settings)
  const fields = parseFormFields(form.fields)
  const defs = await loadFormDefinitions(db, form.account_id, fields)
  const answers = Object.fromEntries(Object.entries(submission.answers ?? {}).map(([k, a]) => [k, a?.value]))
  const v = validateAnswers(fields, answers, {
    accountId: form.account_id,
    defaultCountry: !settings.defaultCountry || settings.defaultCountry === 'auto' ? 'NG' : settings.defaultCountry,
    customFields: defs.customFields,
    tableColumns: defs.tableColumns,
  })
  if (!v.phone) throw new Error('This submission has no valid phone number')
  const existing = (await findExistingContact(db, form.account_id, v.phone)) as Record<string, unknown> | null
  const failed = new Set(
    Object.entries(submission.processing?.steps ?? {})
      .filter(([, s]) => s.ok === false)
      .map(([k]) => k),
  )
  await runSideEffects(db, {
    submissionId: submission.id,
    form,
    settings,
    defs,
    v,
    qualified: submission.qualified,
    payload: { answers: {}, utm: submission.utm ?? {}, clickIds: {}, referrer: submission.referrer ?? undefined } as SubmitPayload,
    pre: { existingContact: existing },
    now: opts.now ?? new Date(),
    only: opts.onlyFailed ? failed : undefined,
  })
}

/** Flat variables for automations / webhooks from a validated submission. */
export function answerVars(
  v: ValidatedAnswers,
  qualified: boolean | null,
  form: Pick<FormRow, 'name'>,
): Record<string, unknown> {
  const hidden: Record<string, unknown> = {}
  for (const s of Object.values(v.snapshot)) {
    // Hidden fields are labelled with their URL parameter name.
    if (typeof s.label === 'string' && /^[a-zA-Z0-9_-]+$/.test(s.label) && !(s.label in hidden)) hidden[s.label] = s.value
  }
  return {
    ...hidden,
    ...v.customByKey,
    name: v.name ?? '',
    email: v.email ?? '',
    company: v.company ?? '',
    message: v.message ?? '',
    phone: v.phone ?? '',
    qualified: qualified === null ? '' : String(qualified),
    form_name: form.name,
  }
}

/**
 * Delete submissions older than the form's retention setting, and funnel events
 * older than 90 days. Runs opportunistically after a submission (no scheduler
 * needed): cheap, bounded, and a no-op when no retention is set.
 */
export async function purgeExpired(db: Db, form: Pick<FormRow, 'id' | 'settings'>, now: Date = new Date()): Promise<void> {
  const days = parseFormSettings(form.settings).rules.retentionDays
  if (days) {
    const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString()
    await db.from('form_submissions').delete().eq('form_id', form.id).lt('created_at', cutoff)
  }
  const eventCutoff = new Date(now.getTime() - 90 * 86_400_000).toISOString()
  await db.from('form_events').delete().eq('form_id', form.id).lt('created_at', eventCutoff)
}

/** Notification body: the visitor's words in quotes first (so it is easy to spot), then the form name. */
export function notificationBody(formName: string, message: string | undefined, notQualified: boolean): string {
  const tail = `${formName}${notQualified ? ' (not qualified)' : ''}`
  const m = (message ?? '').replace(/\s+/g, ' ').trim()
  if (!m) return tail
  return `\u201C${m.length > 140 ? `${m.slice(0, 139)}\u2026` : m}\u201D\n${tail}`
}
