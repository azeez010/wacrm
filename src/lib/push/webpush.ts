// Web Push without Node-only libraries: VAPID (RFC 8292) + message encryption
// (RFC 8291, aes128gcm) on WebCrypto, so it runs on Cloudflare Workers.

const enc = new TextEncoder()

export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToB64url(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

// A raw uncompressed P-256 point (0x04 || X || Y) plus optional private scalar -> JWK.
function jwkFor(pub: Uint8Array, priv?: Uint8Array): JsonWebKey {
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('invalid P-256 public key')
  return {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    ...(priv ? { d: bytesToB64url(priv) } : {}),
    ext: true,
  }
}

export type EncryptOptions = {
  /** Test hooks: fixed server key pair and salt (RFC 8291 appendix A). */
  asPrivate?: Uint8Array
  asPublic?: Uint8Array
  salt?: Uint8Array
}

/** Encrypt a push payload for one subscription. Returns the full request body. */
export async function encryptPayload(
  plaintext: Uint8Array,
  subscription: { p256dh: string; auth: string },
  opts: EncryptOptions = {},
): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(subscription.p256dh)
  const authSecret = b64urlToBytes(subscription.auth)
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16))

  let asPublic: Uint8Array
  let asPrivateKey: CryptoKey
  if (opts.asPrivate && opts.asPublic) {
    asPublic = opts.asPublic
    asPrivateKey = await crypto.subtle.importKey('jwk', jwkFor(opts.asPublic, opts.asPrivate), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    asPrivateKey = pair.privateKey
  }

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivateKey, 256)

  const hkdf = async (ikm: ArrayBuffer | Uint8Array<ArrayBuffer>, s: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number) => {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, key, bytes * 8))
  }

  const ikm = await hkdf(ecdh, authSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const saltBytes = concat(salt)
  const cek = await hkdf(ikm, saltBytes, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(ikm, saltBytes, enc.encode('Content-Encoding: nonce\0'), 12)

  // One record: data then the 0x02 "last record" delimiter.
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))))

  const rs = new Uint8Array([0, 0, 0x10, 0]) // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher)
}

/** VAPID `Authorization` header value for a push service endpoint. */
export async function vapidAuthorization(
  endpoint: string,
  vapid: { publicKey: string; privateKey: string; subject: string },
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const aud = new URL(endpoint).origin
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = bytesToB64url(enc.encode(JSON.stringify({ aud, exp: nowSeconds + 12 * 3600, sub: vapid.subject })))
  const key = await crypto.subtle.importKey(
    'jwk',
    jwkFor(b64urlToBytes(vapid.publicKey), b64urlToBytes(vapid.privateKey)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)))
  return `vapid t=${header}.${claims}.${bytesToB64url(sig)}, k=${vapid.publicKey}`
}

export type PushResult = { ok: true } | { ok: false; status: number; gone: boolean }

/** Send one already-serialized payload. `gone` means the subscription is dead and should be deleted. */
export async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  vapid: { publicKey: string; privateKey: string; subject: string },
  opts: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string } = {},
): Promise<PushResult> {
  try {
    const body = await encryptPayload(enc.encode(payload), subscription)
    const headers: Record<string, string> = {
      Authorization: await vapidAuthorization(subscription.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttl ?? 86400),
      Urgency: opts.urgency ?? 'normal',
    }
    if (opts.topic) headers.Topic = opts.topic
    const res = await fetch(subscription.endpoint, { method: 'POST', headers, body: body as BodyInit })
    if (res.ok) return { ok: true }
    return { ok: false, status: res.status, gone: res.status === 404 || res.status === 410 }
  } catch {
    return { ok: false, status: 0, gone: false }
  }
}
