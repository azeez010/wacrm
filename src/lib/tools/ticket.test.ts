import { describe, expect, it } from 'vitest'
import { verifyTicket } from './ticket'

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i * 3 + 1)))
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// Same algorithm as ogadesk-api src/lib/ticket.ts signTicket.
async function sign(purpose: string, exp: number, key = KEY) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ p: purpose, exp, n: 'x' })))
  const k = await crypto.subtle.importKey('raw', Uint8Array.from(atob(key), (c) => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${purpose}.${payload}`)))
  return `${payload}.${b64url(sig)}`
}

const NOW = 1_800_000_000_000
describe('admin ticket verification', () => {
  it('accepts a fresh ticket for its purpose', async () => {
    expect(await verifyTicket(await sign('embedded-signup-test', NOW / 1000 + 600), 'embedded-signup-test', KEY, NOW)).toEqual({ ok: true })
  })
  it('rejects expired, tampered, wrong-purpose, wrong-key and malformed tickets', async () => {
    const t = await sign('embedded-signup-test', NOW / 1000 + 600)
    expect(await verifyTicket(await sign('embedded-signup-test', NOW / 1000 - 1), 'embedded-signup-test', KEY, NOW)).toEqual({ ok: false, reason: 'expired' })
    const [p, s] = t.split('.')
    expect(await verifyTicket(`${p!.slice(0, -2)}AA.${s}`, 'embedded-signup-test', KEY, NOW)).toMatchObject({ ok: false })
    expect(await verifyTicket(await sign('other', NOW / 1000 + 600), 'embedded-signup-test', KEY, NOW)).toMatchObject({ ok: false })
    expect(await verifyTicket(await sign('embedded-signup-test', NOW / 1000 + 600, btoa(String.fromCharCode(...new Uint8Array(32)))), 'embedded-signup-test', KEY, NOW)).toEqual({ ok: false, reason: 'bad_signature' })
    expect(await verifyTicket('abc', 'embedded-signup-test', KEY, NOW)).toEqual({ ok: false, reason: 'malformed' })
    expect(await verifyTicket('a.b.c', 'embedded-signup-test', KEY, NOW)).toEqual({ ok: false, reason: 'malformed' })
    expect(await verifyTicket('!!.??', 'embedded-signup-test', KEY, NOW)).toEqual({ ok: false, reason: 'malformed' })
    expect(await verifyTicket(null, 'embedded-signup-test', KEY, NOW)).toEqual({ ok: false, reason: 'missing' })
    expect(await verifyTicket(t, 'embedded-signup-test', '', NOW)).toEqual({ ok: false, reason: 'no_key' })
  })
})
