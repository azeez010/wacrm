// Google Calendar OAuth for Settings → Integrations.
//   - the OAuth client (id + secret) is set by the platform admin (console → Platform settings → Integrations),
//     read through platform-config like the Meta settings (console value first, then the environment)
//   - state is HMAC-signed (account, user, expiry 10 min, nonce) with a key derived from ENCRYPTION_KEY, so the
//     callback only accepts a flow this admin started for this workspace
//   - scopes: calendar events + free/busy only; offline access for a refresh token
// Web Crypto only (Workers).

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
]
export const STATE_TTL_SEC = 600
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

export interface OAuthState {
  aid: string
  uid: string
  exp: number
  n: string
}

const enc = new TextEncoder()
const b64url = (bytes: Uint8Array) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64url = (t: string): Uint8Array | null => {
  try {
    const bin = atob(t.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (t.length % 4)) % 4))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

async function key(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const derived = await crypto.subtle.sign('HMAC', base, enc.encode('ogadesk-google-oauth-state-v1'))
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signState(s: Omit<OAuthState, 'n' | 'exp'>, secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  if (!secret) throw new Error('state secret is not configured')
  const payload: OAuthState = { ...s, exp: nowSec + STATE_TTL_SEC, n: b64url(crypto.getRandomValues(new Uint8Array(12))) }
  const body = b64url(enc.encode(JSON.stringify(payload)))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body)))
  return `${body}.${b64url(sig)}`
}

/** The payload when the signature is valid and the state has not expired; null otherwise. */
export async function verifyState(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<OAuthState | null> {
  const [body, sig] = (token ?? '').split('.')
  if (!body || !sig || !secret) return null
  const sigBytes = fromB64url(sig)
  if (!sigBytes) return null
  const ok = await crypto.subtle.verify('HMAC', await key(secret), sigBytes as BufferSource, enc.encode(body))
  if (!ok) return null
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body) ?? new Uint8Array())) as OAuthState
    if (typeof p.aid !== 'string' || typeof p.uid !== 'string' || typeof p.exp !== 'number') return null
    return p.exp > nowSec ? p : null
  } catch {
    return null
  }
}

export function authUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL(AUTH_URL)
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
  u.searchParams.set('access_type', 'offline')
  // Always ask, so Google returns a refresh token even when this account connected before.
  u.searchParams.set('prompt', 'consent')
  u.searchParams.set('include_granted_scopes', 'true')
  u.searchParams.set('state', state)
  return u.toString()
}

export class GoogleAuthError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
    this.name = 'GoogleAuthError'
  }
}

async function tokenCall(params: Record<string, string>, f: typeof fetch) {
  const res = await f(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(10_000),
  })
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new GoogleAuthError(String(j.error_description ?? j.error ?? `HTTP ${res.status}`), typeof j.error === 'string' ? j.error : undefined)
  return j
}

/** Email claim of an ID token we just received from Google's token endpoint over TLS (no signature check needed). */
export function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null
  const part = idToken.split('.')[1]
  const bytes = part ? fromB64url(part) : null
  if (!bytes) return null
  try {
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as { email?: string }
    return typeof claims.email === 'string' ? claims.email : null
  } catch {
    return null
  }
}

export async function exchangeCode(
  args: { code: string; clientId: string; clientSecret: string; redirectUri: string },
  f: typeof fetch = fetch,
): Promise<{ refreshToken: string; accessToken: string; expiresIn: number; email: string | null; scope: string }> {
  const j = await tokenCall({ code: args.code, client_id: args.clientId, client_secret: args.clientSecret, redirect_uri: args.redirectUri, grant_type: 'authorization_code' }, f)
  if (typeof j.refresh_token !== 'string') throw new GoogleAuthError('Google did not return a refresh token. Remove OgaDesk from your Google account permissions and try again.')
  return {
    refreshToken: j.refresh_token,
    accessToken: String(j.access_token ?? ''),
    expiresIn: Number(j.expires_in ?? 3600),
    email: emailFromIdToken(j.id_token),
    scope: String(j.scope ?? ''),
  }
}

export async function refreshAccessToken(
  args: { refreshToken: string; clientId: string; clientSecret: string },
  f: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresIn: number }> {
  const j = await tokenCall({ refresh_token: args.refreshToken, client_id: args.clientId, client_secret: args.clientSecret, grant_type: 'refresh_token' }, f)
  return { accessToken: String(j.access_token ?? ''), expiresIn: Number(j.expires_in ?? 3600) }
}
