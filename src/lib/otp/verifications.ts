// ============================================================
// OTP verifications: create (send a code over WhatsApp), check, read.
//
// One code path serves both "managed" (we generate the code) and "bring your
// own code" (the caller passes `code`). Either way we store only a hash, send
// through the shared send core in OTP mode (code masked in the stored message,
// no inbox noise) and enforce expiry, a guess limit and a per-phone throttle.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '@/lib/api/v1/respond'
import { isUuid } from '@/lib/api/v1/pagination'
import { assertMessageQuota } from '@/lib/billing/usage'
import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import {
  AmbiguousConnectionError,
  NoConnectionError,
  resolveWhatsAppConfig,
} from '@/lib/whatsapp/resolve-config'
import { SendMessageError, sendMessageToConversation } from '@/lib/whatsapp/send-message'
import {
  OTP_LIMITS,
  generateOtpCode,
  hashOtp,
  isAcceptableProvidedCode,
  verifyOtp,
} from './code'

export const DEFAULT_OTP_TEMPLATE = 'otp_verification'
export const DEFAULT_OTP_LANGUAGE = 'en_US'

export type VerificationStatus = 'pending' | 'approved' | 'failed' | 'expired' | 'canceled'

export interface CreateVerificationInput {
  to: unknown
  code?: unknown
  codeLength?: unknown
  ttlSeconds?: unknown
  whatsappConfigId?: unknown
  template?: { name?: unknown; language?: unknown } | null
  metadata?: unknown
}

interface VerificationRow {
  id: string
  account_id: string
  phone: string
  status: VerificationStatus
  attempts: number
  max_attempts: number
  expires_at: string
  whatsapp_config_id: string | null
  message_row_id: string | null
  metadata: Record<string, unknown> | null
  send_error: string | null
  approved_at: string | null
  created_at: string
}

const ROW_COLUMNS =
  'id, account_id, phone, status, attempts, max_attempts, expires_at, whatsapp_config_id, message_row_id, metadata, send_error, approved_at, created_at'

export interface PublicVerification {
  id: string
  status: VerificationStatus
  channel: 'whatsapp'
  to: string
  expires_at: string
  created_at: string
  attempts_remaining: number
  message_id: string | null
  metadata: Record<string, unknown> | null
  delivery: {
    status: string | null
    error: { code: number | null; title: string | null; details: string | null } | null
  }
}

function badRequest(message: string): ApiError {
  return new ApiError('bad_request', message, 400)
}

function intInRange(value: unknown, min: number, max: number, fallback: number, field: string): number {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`'${field}' must be a whole number from ${min} to ${max}`)
  }
  return value
}

function pickTemplate(
  rows: Array<{ id: string; language: string; status: string | null; category: string; whatsapp_config_id: string | null }>,
  configId: string,
  language: string,
) {
  const base = (l: string) => l.toLowerCase().split(/[_-]/)[0]
  const candidates = rows
    .filter((r) => r.whatsapp_config_id === configId || r.whatsapp_config_id === null)
    .filter((r) => r.language === language || base(r.language) === base(language))
  // Exact language, then this connection's own row, first.
  candidates.sort(
    (a, b) =>
      Number(b.language === language) - Number(a.language === language) ||
      Number(b.whatsapp_config_id === configId) - Number(a.whatsapp_config_id === configId),
  )
  return candidates[0] ?? null
}

/** Fetch the delivery state of the message that carried the code. */
async function deliveryFor(db: SupabaseClient, messageRowId: string | null, sendError: string | null) {
  if (!messageRowId) {
    return { status: sendError ? 'failed' : null, error: sendError ? { code: null, title: null, details: sendError } : null }
  }
  const { data } = await db
    .from('messages')
    .select('status, error_code, error_title, error_details')
    .eq('id', messageRowId)
    .maybeSingle()
  if (!data) return { status: null, error: null }
  const failed = data.status === 'failed' || data.error_code != null
  return {
    status: (data.status as string) ?? null,
    error: failed
      ? {
          code: (data.error_code as number | null) ?? null,
          title: (data.error_title as string | null) ?? null,
          details: (data.error_details as string | null) ?? null,
        }
      : null,
  }
}

function effectiveStatus(row: VerificationRow): VerificationStatus {
  if (row.status === 'pending' && new Date(row.expires_at).getTime() <= Date.now()) return 'expired'
  return row.status
}

async function toPublic(db: SupabaseClient, row: VerificationRow): Promise<PublicVerification> {
  return {
    id: row.id,
    status: effectiveStatus(row),
    channel: 'whatsapp',
    to: `+${row.phone}`,
    expires_at: row.expires_at,
    created_at: row.created_at,
    attempts_remaining: Math.max(0, row.max_attempts - row.attempts),
    message_id: row.message_row_id,
    metadata: row.metadata,
    delivery: await deliveryFor(db, row.message_row_id, row.send_error),
  }
}

export async function createVerification(
  db: SupabaseClient,
  accountId: string,
  input: CreateVerificationInput,
): Promise<{ verification: PublicVerification; whatsappMessageId: string }> {
  // ---- validate -------------------------------------------------
  const phone = typeof input.to === 'string' ? parseInternationalPhone(input.to) : null
  if (!phone) {
    throw badRequest("'to' must be an international phone number with a leading + and country code (e.g. +2348012345678)")
  }
  let providedCode: string | null = null
  if (input.code !== undefined && input.code !== null) {
    if (!isAcceptableProvidedCode(input.code)) {
      throw badRequest(`'code' must be ${OTP_LIMITS.providedCodeMin} to ${OTP_LIMITS.providedCodeMax} letters or digits`)
    }
    providedCode = input.code
  }
  const codeLength = intInRange(input.codeLength, OTP_LIMITS.codeLengthMin, OTP_LIMITS.codeLengthMax, OTP_LIMITS.codeLengthDefault, 'code_length')
  const ttl = intInRange(input.ttlSeconds, OTP_LIMITS.ttlMinSeconds, OTP_LIMITS.ttlMaxSeconds, OTP_LIMITS.ttlDefaultSeconds, 'ttl_seconds')
  let metadata: Record<string, unknown> | null = null
  if (input.metadata !== undefined && input.metadata !== null) {
    if (typeof input.metadata !== 'object' || Array.isArray(input.metadata)) {
      throw badRequest("'metadata' must be a JSON object")
    }
    if (Buffer.byteLength(JSON.stringify(input.metadata)) > OTP_LIMITS.metadataMaxBytes) {
      throw badRequest(`'metadata' must be under ${OTP_LIMITS.metadataMaxBytes} bytes`)
    }
    metadata = input.metadata as Record<string, unknown>
  }
  const configIdInput = typeof input.whatsappConfigId === 'string' && input.whatsappConfigId ? input.whatsappConfigId : null
  if (input.whatsappConfigId != null && (!configIdInput || !isUuid(configIdInput))) {
    throw badRequest("'whatsapp_config_id' must be a valid id")
  }
  const templateName =
    typeof input.template?.name === 'string' && input.template.name ? input.template.name : DEFAULT_OTP_TEMPLATE
  const templateLanguage =
    typeof input.template?.language === 'string' && input.template.language ? input.template.language : DEFAULT_OTP_LANGUAGE

  // ---- connection + template ------------------------------------
  let config
  try {
    config = await resolveWhatsAppConfig(db, accountId, configIdInput)
  } catch (err) {
    if (err instanceof AmbiguousConnectionError) throw new ApiError('ambiguous_connection', err.message, 400)
    if (err instanceof NoConnectionError || configIdInput) {
      throw new SendMessageError(
        'whatsapp_not_configured',
        'WhatsApp not configured. Connect a WhatsApp number in Settings → WhatsApp first.',
        400,
      )
    }
    throw err
  }

  const { data: templateRows, error: tplErr } = await db
    .from('message_templates')
    .select('id, language, status, category, whatsapp_config_id')
    .eq('account_id', accountId)
    .eq('name', templateName)
  if (tplErr) throw new ApiError('internal', 'Failed to look up the template', 500)
  const template = pickTemplate(templateRows ?? [], config.id, templateLanguage)
  if (!template) {
    throw new ApiError(
      'template_not_found',
      `No template named "${templateName}" (${templateLanguage}) for this WhatsApp number. Create an authentication template with POST /templates (category "Authentication").`,
      404,
    )
  }
  if (template.category !== 'Authentication') {
    throw badRequest(`Template "${templateName}" is not an authentication template`)
  }
  if (template.status !== 'APPROVED') {
    throw new ApiError(
      'template_not_approved',
      `Template "${templateName}" is ${template.status ?? 'not approved'}. Meta must approve it before codes can be sent.`,
      409,
    )
  }

  // ---- plan quota (a code is one billable authentication message) --
  await assertMessageQuota(db, accountId, 1)

  // ---- throttle (per phone, per account) -------------------------
  const since = new Date(Date.now() - OTP_LIMITS.throttleWindowSeconds * 1000).toISOString()
  const { data: recent } = await db
    .from('otp_verifications')
    .select('created_at')
    .eq('account_id', accountId)
    .eq('phone', phone)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
  if ((recent?.length ?? 0) >= OTP_LIMITS.throttleMax) {
    const oldest = new Date(recent![0].created_at as string).getTime()
    const retryAfter = Math.max(1, Math.ceil((oldest + OTP_LIMITS.throttleWindowSeconds * 1000 - Date.now()) / 1000))
    throw new ApiError(
      'otp_rate_limited',
      `Too many codes requested for this number. Try again in ${retryAfter} seconds.`,
      429,
      { 'Retry-After': String(retryAfter) },
    )
  }

  // ---- store (hash only), then send -------------------------------
  const id = crypto.randomUUID()
  const code = providedCode ?? generateOtpCode(codeLength)
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString()
  const { error: insertErr } = await db.from('otp_verifications').insert({
    id,
    account_id: accountId,
    phone,
    status: 'pending',
    code_hash: hashOtp(id, code),
    max_attempts: OTP_LIMITS.maxAttempts,
    expires_at: expiresAt,
    whatsapp_config_id: config.id,
    metadata,
  })
  if (insertErr) {
    console.error('[otp] insert failed:', insertErr)
    throw new ApiError('internal', 'Failed to create the verification', 500)
  }

  let sent: { messageId: string; whatsappMessageId: string }
  try {
    const conversation = await resolveConversationByPhone(db, accountId, `+${phone}`, null, {
      whatsappConfigId: config.id,
      quiet: true,
    })
    sent = await sendMessageToConversation(db, accountId, {
      conversationId: conversation.conversationId,
      messageType: 'template',
      templateName,
      templateLanguage,
      templateMessageParams: { body: [code] },
      whatsappConfigId: config.id,
      otp: true,
    })
  } catch (err) {
    await db
      .from('otp_verifications')
      .update({ status: 'failed', send_error: err instanceof Error ? err.message : 'Send failed' })
      .eq('id', id)
    throw err
  }

  const { data: updated } = await db
    .from('otp_verifications')
    .update({ message_row_id: sent.messageId })
    .eq('id', id)
    .select(ROW_COLUMNS)
    .single()

  // A newer code replaces older pending ones for this number (only after the
  // new send succeeded, so a failed resend doesn't kill a working code).
  await db
    .from('otp_verifications')
    .update({ status: 'canceled' })
    .eq('account_id', accountId)
    .eq('phone', phone)
    .eq('status', 'pending')
    .neq('id', id)
  // Opportunistic purge of old rows (no cron on Workers).
  void db
    .from('otp_verifications')
    .delete()
    .eq('account_id', accountId)
    .lt('created_at', new Date(Date.now() - 7 * 86400_000).toISOString())
    .then(() => undefined, () => undefined)

  return {
    verification: await toPublic(db, (updated as VerificationRow) ?? ({
      id, account_id: accountId, phone, status: 'pending', attempts: 0, max_attempts: OTP_LIMITS.maxAttempts,
      expires_at: expiresAt, whatsapp_config_id: config.id, message_row_id: sent.messageId, metadata,
      send_error: null, approved_at: null, created_at: new Date().toISOString(),
    } as VerificationRow)),
    whatsappMessageId: sent.whatsappMessageId,
  }
}

async function loadRow(db: SupabaseClient, accountId: string, id: string): Promise<VerificationRow | null> {
  if (!isUuid(id)) return null
  const { data } = await db
    .from('otp_verifications')
    .select(ROW_COLUMNS)
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  return (data as VerificationRow | null) ?? null
}

export async function getVerification(db: SupabaseClient, accountId: string, id: string): Promise<PublicVerification | null> {
  const row = await loadRow(db, accountId, id)
  return row ? toPublic(db, row) : null
}

export interface CheckResult {
  id: string
  status: VerificationStatus
  attempts_remaining: number
}

/**
 * Check a code. A wrong guess answers `pending` with fewer attempts left; the
 * guess is spent atomically in the database (otp_register_attempt) so
 * concurrent requests can never exceed the limit.
 */
export async function checkVerification(
  db: SupabaseClient,
  accountId: string,
  id: string,
  code: string,
): Promise<CheckResult | null> {
  const row = await loadRow(db, accountId, id)
  if (!row) return null
  const remaining = (r: { attempts: number; max_attempts: number }) => Math.max(0, r.max_attempts - r.attempts)

  if (row.status !== 'pending') return { id, status: row.status, attempts_remaining: remaining(row) }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.from('otp_verifications').update({ status: 'expired' }).eq('id', id).eq('status', 'pending')
    return { id, status: 'expired', attempts_remaining: remaining(row) }
  }

  const { data: spent } = await db.rpc('otp_register_attempt', { p_id: id, p_account: accountId })
  const spentRow = (Array.isArray(spent) ? spent[0] : spent) as
    | { code_hash: string; attempts: number; max_attempts: number }
    | undefined
  if (!spentRow) {
    // Out of attempts, expired or settled by a concurrent request.
    const fresh = (await loadRow(db, accountId, id)) ?? row
    if (fresh.status === 'pending' && fresh.attempts >= fresh.max_attempts) {
      await db.from('otp_verifications').update({ status: 'failed' }).eq('id', id).eq('status', 'pending')
      return { id, status: 'failed', attempts_remaining: 0 }
    }
    return { id, status: effectiveStatus(fresh), attempts_remaining: remaining(fresh) }
  }

  if (verifyOtp(id, code, spentRow.code_hash)) {
    await db
      .from('otp_verifications')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')
    return { id, status: 'approved', attempts_remaining: remaining(spentRow) }
  }
  if (spentRow.attempts >= spentRow.max_attempts) {
    await db.from('otp_verifications').update({ status: 'failed' }).eq('id', id).eq('status', 'pending')
    return { id, status: 'failed', attempts_remaining: 0 }
  }
  return { id, status: 'pending', attempts_remaining: remaining(spentRow) }
}
