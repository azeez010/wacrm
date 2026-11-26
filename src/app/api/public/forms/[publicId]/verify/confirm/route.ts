import { supabaseAdmin } from '@/lib/automations/admin-client'
import { loadFormByPublicId } from '@/lib/forms/public-config'
import { corsJson, corsPreflight } from '@/lib/forms/public-http'
import { confirmFormVerification, type VerifyChannel } from '@/lib/forms/verify'
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

export function OPTIONS() {
  return corsPreflight()
}

/** Check the code(s) the visitor typed. On success returns the signed proof to send with the form. */
export async function POST(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const ip = getClientIp(request)
  const limit = checkRateLimit(`form-verify-confirm:${ip}:${publicId}`, { limit: 20, windowMs: RATE_LIMITS.formVerify.windowMs })
  if (!limit.success) return corsJson({ ok: false, error: 'rate_limited' }, 429, { 'Retry-After': '60' })

  const body = (await request.json().catch(() => null)) as { challenge?: unknown; codes?: Partial<Record<VerifyChannel, unknown>> } | null
  const db = supabaseAdmin()
  const form = await loadFormByPublicId(db, publicId)
  if (!form) return corsJson({ ok: false, error: 'not_found' }, 404)

  const r = await confirmFormVerification(db, form, body?.challenge, body?.codes ?? {})
  switch (r.kind) {
    case 'approved':
      return corsJson({ ok: true, status: 'approved', proof: r.proof })
    case 'pending':
      return corsJson({ ok: true, status: 'pending', wrong: r.wrong, attemptsRemaining: r.attemptsRemaining })
    case 'failed':
      return corsJson({ ok: true, status: r.reason === 'expired' ? 'expired' : 'failed' })
    default:
      return corsJson({ ok: false, error: 'invalid_challenge' }, 400)
  }
}
