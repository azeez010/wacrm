// One-off: prints a VAPID key pair for Web Push. Usage: node scripts/gen-vapid.mjs
import { webcrypto as c } from 'node:crypto'
const b64u = (b) => Buffer.from(b).toString('base64url')
const pair = await c.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const jwk = await c.subtle.exportKey('jwk', pair.privateKey)
const pub = new Uint8Array(await c.subtle.exportKey('raw', pair.publicKey))
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${b64u(pub)}`)
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`)
console.log('VAPID_SUBJECT=mailto:support@ogadesk.com')
