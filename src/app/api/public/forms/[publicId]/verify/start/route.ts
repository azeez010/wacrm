import { after } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { loadFormDefinitions } from '@/lib/forms/definitions'
import { loadFormByPublicId } from '@/lib/forms/public-config'
import { corsJson, corsPreflight, verifyTurnstile } from '@/lib/forms/public-http'
import { openState } from '@/lib/forms/submit'
import { parseFormFields, parseFormSettings } from '@/lib/forms/types'
import { validateAnswers } from '@/lib/forms/validate-answers'
import { effectiveVerifyMode, purgeUnverifiedFormContacts, startFormVerification } from '@/lib/forms/verify'
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

const MAX_BODY = 30_000

export function OPTIONS() {
  return corsPreflight()
}

/**
 * Send the verification code(s) for a form. The answers are validated FIRST (so garbage never triggers
 * a message), then the same spam checks as submit apply. Returns a signed challenge to confirm.
 */
export async function POST(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const ip = getClientIp(request)

  const limit = checkRateLimit(`form-verify:${ip}:${publicId}`, RATE_LIMITS.formVerify)
  if (!limit.success) return corsJson({ ok: false, error: 'rate_limited' }, 429, { 'Retry-After': '60' })

  const text = await request.text().catch(() => '')
  if (text.length > MAX_BODY) return corsJson({ ok: false, error: 'too_large' }, 413)
  let body: { answers?: Record<string, unknown>; website?: string; turnstileToken?: string } | null
  try {
    body = JSON.parse(text || '{}')
  } catch {
    return corsJson({ ok: false, error: 'bad_json' }, 400)
  }

  const db = supabaseAdmin()
  const form = await loadFormByPublicId(db, publicId)
  if (!form) return corsJson({ ok: false, error: 'not_found' }, 404)
  const settings = parseFormSettings(form.settings)

  const mode = await effectiveVerifyMode(db, form, settings)
  if (mode === 'off') return corsJson({ ok: true, required: false })

  const now = new Date()
  const state = openState(form, settings, now)
  if (!state.open) return corsJson({ ok: false, error: state.reason === 'closed' ? 'closed' : 'unavailable' }, state.reason === 'not_found' ? 404 : 410)

  // Bots: a filled honeypot gets nothing (and no message is sent).
  if (body?.website && String(body.website).trim() !== '') return corsJson({ ok: false, error: 'unavailable' }, 400)
  if (settings.rules.turnstile && !(await verifyTurnstile(body?.turnstileToken, ip === 'unknown' ? null : ip))) {
    return corsJson({ ok: false, error: 'captcha' }, 400)
  }

  const fields = parseFormFields(form.fields)
  const defs = await loadFormDefinitions(db, form.account_id, fields, settings)
  const v = validateAnswers(fields, body?.answers ?? {}, {
    accountId: form.account_id,
    defaultCountry: !settings.defaultCountry || settings.defaultCountry === 'auto' ? (request.headers.get('cf-ipcountry') ?? 'NG') : settings.defaultCountry,
    customFields: defs.customFields,
    tableColumns: defs.tableColumns,
    now,
  })
  if (!v.ok || !v.phone) return corsJson({ ok: false, error: 'invalid', errors: v.errors }, 400)

  // Tidy up contacts created by earlier codes that were never confirmed (best effort).
  if (Math.random() < 0.2) after(() => purgeUnverifiedFormContacts(db, form.account_id).then(() => undefined, () => undefined))

  const out = await startFormVerification(db, form, { rules: { ...settings.rules, verify: mode } }, { phone: v.phone, email: v.email ?? null, locale: settings.language ?? 'en' }, now)
  switch (out.kind) {
    case 'not_required':
      return corsJson({ ok: true, required: false })
    case 'error':
      if (out.error === 'rate_limited') return corsJson({ ok: false, error: 'rate_limited', retryAfter: out.retryAfter }, 429, { 'Retry-After': String(out.retryAfter ?? 60) })
      return corsJson({ ok: false, error: 'invalid', errors: { email: 'required' } }, 400)
    case 'skipped':
      // We could not send a code: the lead is saved unverified rather than lost.
      return corsJson({ ok: true, required: true, skipped: true, proof: out.proof })
    default:
      return corsJson({ ok: true, required: true, challenge: out.challenge, channels: out.channels, masked: out.masked, resendAfter: 30 })
  }
}
