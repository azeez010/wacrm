import { after } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { loadFormByPublicId } from '@/lib/forms/public-config'
import {
  corsJson,
  corsPreflight,
  deviceFromUserAgent,
  hashIp,
  isBotUserAgent,
  verifyTurnstile,
} from '@/lib/forms/public-http'
import { submitForm } from '@/lib/forms/submit'
import { parseFormSettings } from '@/lib/forms/types'
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

const MAX_BODY = 30_000

export function OPTIONS() {
  return corsPreflight()
}

export async function POST(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const ip = getClientIp(request)

  const limit = checkRateLimit(`form-submit:${ip}:${publicId}`, RATE_LIMITS.formSubmit)
  if (!limit.success) return corsJson({ ok: false, error: 'rate_limited' }, 429, { 'Retry-After': '60' })

  const text = await request.text().catch(() => '')
  if (text.length > MAX_BODY) return corsJson({ ok: false, error: 'too_large' }, 413)
  let body: unknown
  try {
    body = JSON.parse(text || '{}')
  } catch {
    return corsJson({ ok: false, error: 'bad_json' }, 400)
  }

  const db = supabaseAdmin()
  const form = await loadFormByPublicId(db, publicId)
  if (!form) return corsJson({ ok: false, error: 'not_found' }, 404)

  const settings = parseFormSettings(form.settings)
  if (settings.rules.turnstile) {
    const token = (body as { turnstileToken?: string } | null)?.turnstileToken
    if (!(await verifyTurnstile(token, ip === 'unknown' ? null : ip))) {
      return corsJson({ ok: false, error: 'captcha' }, 400)
    }
  }

  const ua = request.headers.get('user-agent')
  // Funnel: every submit press counts as an attempt, even when validation fails.
  const vid = (body as { visitorId?: unknown } | null)?.visitorId
  if (typeof vid === 'string' && vid.length >= 8 && vid.length <= 64 && !isBotUserAgent(ua)) {
    await db
      .from('form_events')
      .insert({ form_id: form.id, account_id: form.account_id, visitor_id: vid, type: 'attempt' })
      .then(() => undefined, () => undefined)
  }
  const out = await submitForm(db, form, body, {
    ipHash: ip === 'unknown' ? null : await hashIp(ip),
    country: request.headers.get('cf-ipcountry'),
    device: deviceFromUserAgent(ua),
    source: 'public',
  })
  if (out.finish) {
    const run = out.finish
    after(async () => {
      try {
        await run()
      } catch (err) {
        console.error('[forms] side effects failed:', err)
      }
    })
  }

  const r = out.result
  switch (r.status) {
    case 'ok':
      // Deliberately identical for new / existing / held / not-qualified-but-saved.
      return corsJson({ ok: true, success: r.success })
    case 'invalid':
      return corsJson({ ok: false, error: 'invalid', errors: r.errors }, 400)
    case 'closed':
      return corsJson({ ok: false, error: 'closed', message: r.message }, 410)
    case 'gated':
      return corsJson({ ok: false, error: 'gated', message: r.message }, 200)
    case 'not_found':
      return corsJson({ ok: false, error: 'not_found' }, 404)
    default:
      return corsJson({ ok: false, error: 'unavailable' }, 503)
  }
}
