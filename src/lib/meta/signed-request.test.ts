import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseSignedRequest } from './signed-request'

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function sign(payload: object, secret: string) {
  const body = b64url(JSON.stringify(payload))
  const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest())
  return `${sig}.${body}`
}

describe('parseSignedRequest', () => {
  const payload = { user_id: '1234', algorithm: 'HMAC-SHA256', issued_at: 1 }

  it('accepts a request signed with a configured secret', () => {
    expect(parseSignedRequest(sign(payload, 's3cret'), ['s3cret'])?.user_id).toBe('1234')
  })

  it('accepts any of several configured secrets', () => {
    expect(parseSignedRequest(sign(payload, 'b'), ['a', 'b'])?.user_id).toBe('1234')
  })

  it('rejects a wrong signature, a tampered payload and a missing secret', () => {
    expect(parseSignedRequest(sign(payload, 'other'), ['s3cret'])).toBeNull()
    const [sig] = sign(payload, 's3cret').split('.')
    const forged = `${sig}.${b64url(JSON.stringify({ ...payload, user_id: '999' }))}`
    expect(parseSignedRequest(forged, ['s3cret'])).toBeNull()
    expect(parseSignedRequest(sign(payload, 's3cret'), [])).toBeNull()
  })

  it('rejects malformed input and unsupported algorithms', () => {
    expect(parseSignedRequest('nope', ['s3cret'])).toBeNull()
    expect(parseSignedRequest(null, ['s3cret'])).toBeNull()
    expect(parseSignedRequest(sign({ ...payload, algorithm: 'HMAC-SHA1' }, 's3cret'), ['s3cret'])).toBeNull()
  })
})
