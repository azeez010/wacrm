import crypto from 'node:crypto'
import { parseAppSecrets } from '@/lib/whatsapp/webhook-signature'

/**
 * Parse and verify a Meta `signed_request` (used by the deauthorize and
 * data-deletion callbacks).
 *
 * Format: `<base64url(HMAC-SHA256 signature)>.<base64url(JSON payload)>`,
 * signed with the app secret. META_APP_SECRET may hold several secrets
 * (comma separated, one per Meta app), so a request is valid when it
 * matches any of them. Fails closed when no secret is configured.
 *
 * Reference: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow#deletion-callback
 */

export type MetaSignedPayload = {
  user_id?: string
  algorithm?: string
  issued_at?: number
  [key: string]: unknown
}

function b64urlToBuffer(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

export function parseSignedRequest(
  signedRequest: string | null | undefined,
  secrets: string[] = parseAppSecrets(process.env.META_APP_SECRET),
): MetaSignedPayload | null {
  if (!signedRequest || secrets.length === 0) return null

  const parts = signedRequest.split('.')
  if (parts.length !== 2) return null
  const [encodedSig, encodedPayload] = parts

  const sig = b64urlToBuffer(encodedSig)
  let verified = false
  for (const secret of secrets) {
    const expected = crypto.createHmac('sha256', secret).update(encodedPayload).digest()
    if (sig.length === expected.length && crypto.timingSafeEqual(sig, expected)) verified = true
  }
  if (!verified) return null

  try {
    const payload = JSON.parse(b64urlToBuffer(encodedPayload).toString('utf8')) as MetaSignedPayload
    if (payload.algorithm && String(payload.algorithm).toUpperCase() !== 'HMAC-SHA256') return null
    return payload
  } catch {
    return null
  }
}
