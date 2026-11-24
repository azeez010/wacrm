// ============================================================
// Signed chat tokens. A website visitor has no account, so what proves "this
// browser owns conversation X" is an HMAC-signed token handed out when the
// chat starts. The same format (role 'agent', short expiry) lets a signed-in
// teammate join a room's WebSocket.
//
// Web Crypto only, so it runs in the Worker entry, in Next route handlers and
// in tests. The secret is passed in (ENCRYPTION_KEY) rather than read here.
// ============================================================

export type ChatRole = 'visitor' | 'agent'

export interface ChatTokenPayload {
  /** Conversation id the token is scoped to. */
  cid: string
  /** Account id. */
  aid: string
  /** Visitor id (visitors) or user id (agents). */
  sub: string
  role: ChatRole
  /** Expiry, seconds since epoch. */
  exp: number
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function b64urlEncode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(text: string): Uint8Array | null {
  try {
    const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4))
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  // Derive a purpose-specific key so a chat token can never double as anything
  // else signed with the same secret.
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const derived = await crypto.subtle.sign('HMAC', base, enc.encode('ogadesk-chat-token-v1'))
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signChatToken(payload: ChatTokenPayload, secret: string): Promise<string> {
  if (!secret) throw new Error('chat token secret is not configured')
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body))
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`
}

/** The payload when the signature is valid and the token has not expired, else null. */
export async function verifyChatToken(
  token: string | null | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<ChatTokenPayload | null> {
  if (!token || !secret || token.length > 2048) return null
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  const body = token.slice(0, dot)
  const sig = b64urlDecode(token.slice(dot + 1))
  if (!sig) return null
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig as BufferSource, enc.encode(body))
  if (!ok) return null
  const raw = b64urlDecode(body)
  if (!raw) return null
  let p: Partial<ChatTokenPayload>
  try {
    p = JSON.parse(dec.decode(raw))
  } catch {
    return null
  }
  if (
    typeof p.cid !== 'string' || typeof p.aid !== 'string' || typeof p.sub !== 'string' ||
    (p.role !== 'visitor' && p.role !== 'agent') || typeof p.exp !== 'number'
  ) return null
  if (p.exp <= nowSeconds) return null
  return p as ChatTokenPayload
}

export const VISITOR_TOKEN_TTL_S = 60 * 60 * 24 * 7
export const AGENT_TOKEN_TTL_S = 60 * 5
