import { describe, expect, it } from 'vitest'
import { b64urlToBytes, bytesToB64url, encryptPayload, vapidAuthorization } from './webpush'

// RFC 8291 appendix A.
const V = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

describe('web push encryption', () => {
  it('matches the RFC 8291 example', async () => {
    const out = await encryptPayload(new TextEncoder().encode(V.plaintext), { p256dh: V.uaPublic, auth: V.auth }, {
      asPrivate: b64urlToBytes(V.asPrivate),
      asPublic: b64urlToBytes(V.asPublic),
      salt: b64urlToBytes(V.salt),
    })
    expect(bytesToB64url(out)).toBe(V.body)
  })

  it('round-trips with a random server key', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    const out = await encryptPayload(new TextEncoder().encode('hi'), { p256dh: bytesToB64url(pub), auth: V.auth })
    expect(out.length).toBeGreaterThan(86 + 18)
    expect(out[20]).toBe(65)
  })
})

describe('vapid', () => {
  it('signs a verifiable ES256 token for the endpoint origin', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    const header = await vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc',
      { publicKey: bytesToB64url(pub), privateKey: jwk.d!, subject: 'mailto:a@b.co' },
      1_000_000,
    )
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!
    expect(m).toBeTruthy()
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(m[2])))
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_000_000 + 43200, sub: 'mailto:a@b.co' })
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      b64urlToBytes(m[3]),
      new TextEncoder().encode(`${m[1]}.${m[2]}`),
    )
    expect(ok).toBe(true)
    expect(m[4]).toBe(bytesToB64url(pub))
  })
})
