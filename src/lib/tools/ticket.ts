// Verifies the short-lived tickets the admin console issues (ogadesk-api src/lib/ticket.ts): HMAC-SHA256 over
// base64url(JSON {p: purpose, exp, n}) keyed by PLATFORM_SECRETS_KEY with the purpose as a label.
// A ticket only proves "an admin issued this recently". Web Crypto, so it runs on Workers and Node.

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const fromB64url = (s: string) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))

export type TicketResult = { ok: true } | { ok: false; reason: 'missing' | 'malformed' | 'bad_signature' | 'expired' | 'wrong_purpose' | 'no_key' }

export async function verifyTicket(
  token: string | null | undefined,
  purpose: string,
  base64Key: string | undefined = process.env.PLATFORM_SECRETS_KEY,
  now: number = Date.now(),
): Promise<TicketResult> {
  if (!token) return { ok: false, reason: 'missing' }
  if (!base64Key) return { ok: false, reason: 'no_key' }
  const [payload, sig, extra] = token.split('.')
  if (!payload || !sig || extra !== undefined) return { ok: false, reason: 'malformed' }
  let claims: { p?: string; exp?: number }
  let sigBytes: Uint8Array
  try {
    claims = JSON.parse(new TextDecoder().decode(fromB64url(payload)))
    sigBytes = fromB64url(sig)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  const key = await crypto.subtle.importKey('raw', fromB64(base64Key), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  // crypto.subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes as BufferSource, new TextEncoder().encode(`${purpose}.${payload}`))
  if (!valid) return { ok: false, reason: 'bad_signature' }
  if (claims.p !== purpose) return { ok: false, reason: 'wrong_purpose' }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now) return { ok: false, reason: 'expired' }
  return { ok: true }
}
