// ============================================================
// Email codes for form verification. Same hashing, expiry and guess limit as the WhatsApp
// codes (rows in otp_verifications with channel 'email'; checkVerification works for both),
// sent DIRECTLY through the email provider: a visitor is waiting, so not the 5-minute outbox.
// ============================================================

import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { ApiError } from '@/lib/api/v1/respond'
import { isEmailEnabled, getEmailProvider } from '@/lib/crm/registry'
import { renderEmail } from '@/lib/email/render'
import { sender } from '@/lib/email/queue'
import { OTP_LIMITS, generateOtpCode, hashOtp } from './code'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Can this platform send verification emails at all? */
export function emailCodesAvailable(): boolean {
  return isEmailEnabled() && sender() !== null
}

export interface EmailVerificationInput {
  email: string
  /** The lead's phone (digits), kept on the row so the pair is bound together. */
  phone: string
  formName: string
  locale?: string | null
  metadata?: Record<string, unknown>
  ttlSeconds?: number
}

export async function createEmailVerification(
  db: SupabaseClient,
  accountId: string,
  input: EmailVerificationInput,
): Promise<{ id: string; expiresAt: string }> {
  const email = input.email.trim().toLowerCase()
  if (!EMAIL_RE.test(email) || email.length > 254) throw new ApiError('bad_request', 'Enter a valid email address', 400)
  const provider = getEmailProvider()
  const from = sender()
  if (!provider || !from) throw new ApiError('unavailable', 'Email codes are not available on this server', 503)

  // Throttle per address, like the per-phone throttle for WhatsApp codes.
  const since = new Date(Date.now() - OTP_LIMITS.throttleWindowSeconds * 1000).toISOString()
  const { data: recent } = await db
    .from('otp_verifications')
    .select('created_at')
    .eq('account_id', accountId)
    .eq('channel', 'email')
    .eq('email', email)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
  if ((recent?.length ?? 0) >= OTP_LIMITS.throttleMax) {
    const oldest = new Date(recent![0].created_at as string).getTime()
    const retryAfter = Math.max(1, Math.ceil((oldest + OTP_LIMITS.throttleWindowSeconds * 1000 - Date.now()) / 1000))
    throw new ApiError('otp_rate_limited', `Too many codes requested for this address. Try again in ${retryAfter} seconds.`, 429, { 'Retry-After': String(retryAfter) })
  }

  const id = crypto.randomUUID()
  const ttl = input.ttlSeconds ?? OTP_LIMITS.ttlDefaultSeconds
  const code = generateOtpCode(OTP_LIMITS.codeLengthDefault)
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString()
  const { error: insertErr } = await db.from('otp_verifications').insert({
    id,
    account_id: accountId,
    phone: input.phone,
    email,
    channel: 'email',
    status: 'pending',
    code_hash: hashOtp(id, code),
    max_attempts: OTP_LIMITS.maxAttempts,
    expires_at: expiresAt,
    metadata: input.metadata ?? null,
  })
  if (insertErr) throw new ApiError('internal', 'Failed to create the verification', 500)

  try {
    const rendered = await renderEmail('form_code', input.locale, { code, formName: input.formName, minutes: Math.max(1, Math.round(ttl / 60)) })
    await provider.send({ to: { email }, from, subject: rendered.subject, html: rendered.html, text: rendered.text, tags: ['form_code'] })
  } catch (err) {
    await db.from('otp_verifications').update({ status: 'failed', send_error: err instanceof Error ? err.message : 'Send failed' }).eq('id', id)
    throw err
  }

  // A newer code replaces older pending ones for this address (only after the send worked).
  await db
    .from('otp_verifications')
    .update({ status: 'canceled' })
    .eq('account_id', accountId)
    .eq('channel', 'email')
    .eq('email', email)
    .eq('status', 'pending')
    .neq('id', id)

  return { id, expiresAt }
}
