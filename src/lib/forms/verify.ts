// ============================================================
// Verify-by-code on lead forms. Before a lead is saved the visitor types a code we sent to their
// WhatsApp number and/or email, so ghost numbers (which never receive it) are never stored.
//
//   start    -> sends the code(s), returns a signed `challenge` (15 min)
//   confirm  -> checks the code(s), returns a signed `proof` (20 min, bound to this form + phone + email)
//   consume  -> at submit time: the proof must match, and can be used ONCE
//
// Infrastructure problems (quota used up, provider down, template not approved) never cost a lead:
// that channel is dropped, and if nothing could be sent the visitor gets a proof marked `dropped`
// so the lead is saved UNVERIFIED and flagged. A wrong or missing code never saves the lead.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { ApiError } from '@/lib/api/v1/respond'
import { assertFeature } from '@/lib/billing/entitlements'
import { emailCodesAvailable, createEmailVerification } from '@/lib/otp/email-otp'
import { readToken, signToken } from '@/lib/otp/code'
import { checkVerification, createVerification, DEFAULT_OTP_TEMPLATE } from '@/lib/otp/verifications'
import type { FormRow, FormSettings } from './types'

export type VerifyMode = 'off' | 'whatsapp' | 'email' | 'both'
export type VerifyChannel = 'whatsapp' | 'email'

export const CHALLENGE_TTL_SECONDS = 15 * 60
export const PROOF_TTL_SECONDS = 20 * 60
/** Codes sent per account per day for forms (abuse and cost guard). */
export const FORM_CODE_DAILY_CAP = 500
/** Unconfirmed WhatsApp codes: the contact they created is removed after this long. */
export const UNVERIFIED_CONTACT_GRACE_MS = 30 * 60 * 1000

export function channelsFor(mode: VerifyMode | undefined): VerifyChannel[] {
  if (mode === 'both') return ['whatsapp', 'email']
  if (mode === 'whatsapp') return ['whatsapp']
  if (mode === 'email') return ['email']
  return []
}

const digits = (s: string) => s.replace(/\D/g, '')
const lowerEmail = (e: string | null | undefined) => (e ? e.trim().toLowerCase() : null)

export function maskPhone(phone: string): string {
  const d = digits(phone)
  return d.length <= 5 ? `+${d}` : `+${d.slice(0, 3)}${'•'.repeat(Math.max(3, d.length - 5))}${d.slice(-2)}`
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!domain) return email
  return `${user.slice(0, 1)}${'•'.repeat(Math.min(5, Math.max(2, user.length - 1)))}@${domain}`
}

// ---------------- availability (what the editor and the server agree on) ----------------

export interface VerifyAvailability {
  whatsapp: { ok: boolean; reason?: 'no_connection' | 'no_template' | 'template_pending' | 'template_rejected' }
  email: { ok: boolean; reason?: 'email_off' }
}

export async function verifyAvailability(db: SupabaseClient, accountId: string): Promise<VerifyAvailability> {
  const [{ count: connections }, { data: templates }] = await Promise.all([
    db.from('whatsapp_config').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
    db.from('message_templates').select('status, category').eq('account_id', accountId).eq('name', DEFAULT_OTP_TEMPLATE),
  ])
  const rows = ((templates ?? []) as { status: string | null; category: string }[]).filter((t) => t.category === 'Authentication')
  let whatsapp: VerifyAvailability['whatsapp']
  if ((connections ?? 0) === 0) whatsapp = { ok: false, reason: 'no_connection' }
  else if (rows.some((t) => t.status === 'APPROVED')) whatsapp = { ok: true }
  else if (rows.some((t) => t.status === 'PENDING' || t.status === 'IN_APPEAL')) whatsapp = { ok: false, reason: 'template_pending' }
  else if (rows.length > 0) whatsapp = { ok: false, reason: 'template_rejected' }
  else whatsapp = { ok: false, reason: 'no_template' }
  return { whatsapp, email: emailCodesAvailable() ? { ok: true } : { ok: false, reason: 'email_off' } }
}

// ---------------- start ----------------

interface ChallengeToken extends Record<string, unknown> {
  f: string
  ph: string
  em: string | null
  ids: { whatsapp?: string; email?: string }
  dropped?: string[]
}

interface ProofToken extends Record<string, unknown> {
  f: string
  ph: string
  em: string | null
  ids: { whatsapp?: string; email?: string }
  dropped?: string[]
}

export type StartResult =
  | { kind: 'not_required' }
  | { kind: 'error'; error: 'email_required' | 'rate_limited'; retryAfter?: number }
  | { kind: 'skipped'; proof: string; reason: string }
  | { kind: 'challenge'; challenge: string; channels: VerifyChannel[]; masked: { phone?: string; email?: string }; dropped: string[] }

export async function startFormVerification(
  db: SupabaseClient,
  form: Pick<FormRow, 'id' | 'account_id' | 'name'>,
  settings: Pick<FormSettings, 'rules'>,
  input: { phone: string; email?: string | null; locale?: string | null },
  now: Date = new Date(),
): Promise<StartResult> {
  const channels = channelsFor(settings.rules.verify as VerifyMode | undefined)
  if (channels.length === 0) return { kind: 'not_required' }
  const phone = digits(input.phone)
  const email = lowerEmail(input.email)
  if (channels.includes('email') && !email) return { kind: 'error', error: 'email_required' }

  const proofFor = (ids: ProofToken['ids'], dropped: string[]) =>
    signToken('vp', { f: form.id, ph: phone, em: email, ids, ...(dropped.length ? { dropped } : {}) }, PROOF_TTL_SECONDS, now.getTime())

  // Daily cap: past it we stop sending (and let the lead through unverified) rather than lose it.
  const { count: today } = await db
    .from('otp_verifications')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', form.account_id)
    .filter('metadata->>purpose', 'eq', 'form')
    .gte('created_at', new Date(now.getTime() - 24 * 3600_000).toISOString())
  if ((today ?? 0) >= FORM_CODE_DAILY_CAP) return { kind: 'skipped', proof: proofFor({}, ['daily_cap']), reason: 'daily_cap' }

  const ids: ChallengeToken['ids'] = {}
  const dropped: string[] = []
  for (const channel of channels) {
    try {
      if (channel === 'whatsapp') {
        const r = await createVerification(db, form.account_id, { to: `+${phone}`, metadata: { purpose: 'form', form_id: form.id } })
        ids.whatsapp = r.verification.id
      } else {
        const r = await createEmailVerification(db, form.account_id, { email: email!, phone, formName: form.name, locale: input.locale, metadata: { purpose: 'form', form_id: form.id } })
        ids.email = r.id
      }
    } catch (err) {
      // Too many codes for this number/address is the visitor's problem; everything else is ours.
      if (err instanceof ApiError && err.code === 'otp_rate_limited') {
        return { kind: 'error', error: 'rate_limited', retryAfter: Number(err.headers?.['Retry-After']) || 60 }
      }
      console.warn(`[forms] ${channel} verification code not sent:`, err instanceof Error ? err.message : err)
      dropped.push(channel)
    }
  }

  if (!ids.whatsapp && !ids.email) return { kind: 'skipped', proof: proofFor({}, dropped), reason: dropped.join(',') || 'unavailable' }
  const sent = (Object.keys(ids) as VerifyChannel[])
  return {
    kind: 'challenge',
    challenge: signToken('vc', { f: form.id, ph: phone, em: email, ids, ...(dropped.length ? { dropped } : {}) }, CHALLENGE_TTL_SECONDS, now.getTime()),
    channels: sent,
    masked: { ...(ids.whatsapp ? { phone: maskPhone(phone) } : {}), ...(ids.email && email ? { email: maskEmail(email) } : {}) },
    dropped,
  }
}

// ---------------- confirm ----------------

export type ConfirmResult =
  | { kind: 'invalid' }
  | { kind: 'approved'; proof: string }
  | { kind: 'pending'; attemptsRemaining: Partial<Record<VerifyChannel, number>>; wrong: VerifyChannel[] }
  | { kind: 'failed'; reason: 'expired' | 'too_many_attempts' }

export async function confirmFormVerification(
  db: SupabaseClient,
  form: Pick<FormRow, 'id' | 'account_id'>,
  challenge: unknown,
  codes: Partial<Record<VerifyChannel, unknown>>,
  now: Date = new Date(),
): Promise<ConfirmResult> {
  const ch = readToken<ChallengeToken>('vc', challenge, now.getTime())
  if (!ch || ch.f !== form.id) return { kind: 'invalid' }

  const attempts: Partial<Record<VerifyChannel, number>> = {}
  const wrong: VerifyChannel[] = []
  let failed: 'expired' | 'too_many_attempts' | null = null
  for (const channel of Object.keys(ch.ids) as VerifyChannel[]) {
    const id = ch.ids[channel]!
    const code = typeof codes[channel] === 'string' ? (codes[channel] as string).trim() : ''
    if (!/^[A-Za-z0-9]{4,15}$/.test(code)) {
      // Nothing usable typed for this channel: fine if it was already confirmed on an earlier try.
      const { data: row } = await db.from('otp_verifications').select('status').eq('id', id).eq('account_id', form.account_id).maybeSingle()
      if ((row as { status?: string } | null)?.status !== 'approved') wrong.push(channel)
      continue
    }
    const r = await checkVerification(db, form.account_id, id, code)
    if (!r) return { kind: 'invalid' }
    attempts[channel] = r.attempts_remaining
    if (r.status === 'approved') continue
    if (r.status === 'expired' || r.status === 'canceled') failed = 'expired'
    else if (r.status === 'failed') failed = 'too_many_attempts'
    else wrong.push(channel)
  }
  if (failed) return { kind: 'failed', reason: failed }
  if (wrong.length > 0) return { kind: 'pending', attemptsRemaining: attempts, wrong }

  return {
    kind: 'approved',
    proof: signToken('vp', { f: ch.f, ph: ch.ph, em: ch.em, ids: ch.ids, ...(ch.dropped?.length ? { dropped: ch.dropped } : {}) }, PROOF_TTL_SECONDS, now.getTime()),
  }
}

// ---------------- consume (submit time) ----------------

export interface VerifiedInfo {
  whatsapp: boolean
  email: boolean
  /** Channels we could not send a code on (lead saved without that proof). */
  dropped?: string[]
  /** The code send created the contact; the submission keeps it. */
  contactCreatedByCode: boolean
}

/** Check the proof against what is being submitted, and spend it. */
export async function consumeProof(
  db: SupabaseClient,
  form: Pick<FormRow, 'id' | 'account_id'>,
  proof: unknown,
  submitted: { phone: string; email?: string | null },
  now: Date = new Date(),
): Promise<{ ok: true; verified: VerifiedInfo } | { ok: false }> {
  const p = readToken<ProofToken>('vp', proof, now.getTime())
  if (!p || p.f !== form.id) return { ok: false }
  if (p.ph !== digits(submitted.phone)) return { ok: false }
  if (p.em && p.em !== lowerEmail(submitted.email)) return { ok: false }

  const ids = Object.values(p.ids ?? {}).filter((x): x is string => typeof x === 'string')
  let contactCreatedByCode = false
  if (ids.length > 0) {
    // One statement: only rows that are approved and not yet spent are updated, so a replay finds none.
    const { data } = await db
      .from('otp_verifications')
      .update({ consumed_at: now.toISOString() })
      .in('id', ids)
      .eq('account_id', form.account_id)
      .eq('status', 'approved')
      .is('consumed_at', null)
      .select('id, channel, metadata')
    const rows = (data ?? []) as { id: string; channel: string; metadata: { contact_created?: boolean } | null }[]
    if (rows.length !== ids.length) return { ok: false }
    contactCreatedByCode = rows.some((r) => r.metadata?.contact_created === true)
  }
  return {
    ok: true,
    verified: { whatsapp: !!p.ids?.whatsapp, email: !!p.ids?.email, ...(p.dropped?.length ? { dropped: p.dropped } : {}), contactCreatedByCode },
  }
}

// ---------------- clean-up of codes that were never confirmed ----------------

/**
 * Sending a WhatsApp code creates a (closed) conversation and, for a number we did not know, a
 * contact. If the code is never confirmed (a ghost number, a typo, someone who left), that contact
 * would be a stored ghost: remove it again, unless the number has since shown signs of life
 * (an inbound message, a deal, or a lead linked to it). Runs opportunistically; best effort.
 */
export async function purgeUnverifiedFormContacts(db: SupabaseClient, accountId: string, now: Date = new Date()): Promise<number> {
  const { data } = await db
    .from('otp_verifications')
    .select('id, metadata')
    .eq('account_id', accountId)
    .eq('channel', 'whatsapp')
    .neq('status', 'approved')
    .filter('metadata->>purpose', 'eq', 'form')
    .filter('metadata->>contact_created', 'eq', 'true')
    .is('consumed_at', null)
    .lt('created_at', new Date(now.getTime() - UNVERIFIED_CONTACT_GRACE_MS).toISOString())
    .gt('created_at', new Date(now.getTime() - 48 * 3600_000).toISOString())
    .limit(25)
  let removed = 0
  for (const row of (data ?? []) as { id: string; metadata: { contact_id?: string | null; cleaned?: boolean } | null }[]) {
    const contactId = row.metadata?.contact_id
    if (!contactId || row.metadata?.cleaned) continue
    const alive = await hasLife(db, accountId, contactId)
    if (!alive) {
      const { error } = await db.from('contacts').delete().eq('id', contactId).eq('account_id', accountId)
      if (!error) removed++
    }
    // Either way, don't look at this one again.
    await db.from('otp_verifications').update({ metadata: { ...(row.metadata ?? {}), cleaned: true, kept: alive } }).eq('id', row.id)
  }
  return removed
}

async function hasLife(db: SupabaseClient, accountId: string, contactId: string): Promise<boolean> {
  const [inbound, deals, leads] = await Promise.all([
    db.from('messages').select('id, conversations!inner(contact_id)', { count: 'exact', head: true }).eq('conversations.contact_id', contactId).eq('direction', 'inbound'),
    db.from('deals').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('contact_id', contactId),
    db.from('form_submissions').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('contact_id', contactId),
  ])
  return (inbound.count ?? 0) > 0 || (deals.count ?? 0) > 0 || (leads.count ?? 0) > 0
}

/**
 * The verification mode that actually applies: the form's setting, but off for anything that is not a
 * lead form, and off if the plan no longer includes advanced forms (a downgrade must not lock leads out).
 */
export async function effectiveVerifyMode(
  db: SupabaseClient,
  form: Pick<FormRow, 'kind' | 'account_id'>,
  settings: Pick<FormSettings, 'rules'>,
): Promise<VerifyMode> {
  const mode = (settings.rules.verify ?? 'off') as VerifyMode
  if (mode === 'off' || form.kind !== 'lead') return 'off'
  const ok = await assertFeature(db, form.account_id, 'forms_advanced').then(() => true, () => false)
  return ok ? mode : 'off'
}
