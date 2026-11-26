// Platform secrets (payment keys, later Meta secrets) are encrypted by the admin API and decrypted
// here with PLATFORM_SECRETS_KEY: AES-256-GCM, base64(iv[12] || ciphertext+tag). Same format as
// ogadesk-api/src/lib/crypto.ts encryptSecret. Web Crypto only, so it runs on Workers and Node.

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function key(base64Key: string): Promise<CryptoKey> {
  const raw = b64(base64Key)
  if (raw.length !== 32) throw new Error('PLATFORM_SECRETS_KEY must be base64 of exactly 32 bytes')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptPlatformSecret(plain: string, base64Key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(base64Key), new TextEncoder().encode(plain)))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  let s = ''
  for (const b of out) s += String.fromCharCode(b)
  return btoa(s)
}

export async function decryptPlatformSecret(blob: string, base64Key: string): Promise<string> {
  const all = b64(blob)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await key(base64Key), all.slice(12))
  return new TextDecoder().decode(plain)
}

/** Decrypts an instance's secrets object; {} when there are none. Throws when the key is missing or wrong. */
export async function decryptSecretsObject(blob: string | null | undefined, base64Key = process.env.PLATFORM_SECRETS_KEY): Promise<Record<string, string>> {
  if (!blob) return {}
  if (!base64Key) throw new Error('PLATFORM_SECRETS_KEY is not set')
  const parsed = JSON.parse(await decryptPlatformSecret(blob, base64Key)) as unknown
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
}
