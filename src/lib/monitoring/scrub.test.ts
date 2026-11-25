import { describe, expect, it } from 'vitest'

import { scrubEvent, scrubText, scrubUrl } from './scrub'

describe('scrubText', () => {
  it('removes phone numbers, emails and keys', () => {
    expect(scrubText('send to +234 803 123 4567 failed')).toBe('send to [phone] failed')
    expect(scrubText('contact ada@example.com not found')).toBe('contact [email] not found')
    expect(scrubText('bad key wacrm_live_AbC123_xyz')).toBe('bad key [api-key]')
    expect(scrubText('secret whsec_abc123')).toBe('secret [webhook-secret]')
    expect(scrubText('Authorization: Bearer abcdef123456')).toContain('Bearer [redacted]')
  })
  it('keeps ordinary text and short numbers', () => {
    expect(scrubText('status 404 on /api/forms in 120ms')).toBe('status 404 on /api/forms in 120ms')
  })
})

describe('scrubUrl', () => {
  it('hides credentials in the query string (the MCP URL carries the key)', () => {
    expect(scrubUrl('https://ogadesk.com/api/mcp?key=wacrm_live_abc&x=1')).toBe('https://ogadesk.com/api/mcp?key=[redacted]&x=1')
    expect(scrubUrl('https://x.test/cb?code=123456&state=ok')).toBe('https://x.test/cb?code=[redacted]&state=ok')
  })
})

describe('scrubEvent', () => {
  it('strips request bodies, cookies and sensitive headers', () => {
    const e = scrubEvent({
      request: {
        url: 'https://ogadesk.com/api/mcp?key=secret1',
        cookies: { sb: 'x' },
        data: { message: 'hi', phone: '+2348031234567' },
        headers: { authorization: 'Bearer abc', 'user-agent': 'curl', 'x-api-key': 'k' },
      },
    })
    expect(e.request?.data).toBeUndefined()
    expect(e.request?.cookies).toBeUndefined()
    expect(e.request?.url).toContain('key=[redacted]')
    expect(e.request?.headers).toMatchObject({ authorization: '[redacted]', 'x-api-key': '[redacted]', 'user-agent': 'curl' })
  })
  it('keeps only an opaque user id', () => {
    const e = scrubEvent({ user: { id: 'u-1', email: 'a@b.co', ip_address: '1.2.3.4', username: 'ada' } })
    expect(e.user).toEqual({ id: 'u-1' })
    expect(scrubEvent({ user: { email: 'a@b.co' } }).user).toEqual({})
  })
  it('cleans exception text, breadcrumbs and extra data', () => {
    const e = scrubEvent({
      exception: { values: [{ value: 'Cannot send to +2348031234567' }] },
      breadcrumbs: [{ message: 'fetch ada@example.com', data: { url: '/x?token=abc', body: 'hello' } }],
      extra: { phone: '+2348031234567', note: 'ok' },
    })
    expect(e.exception?.values?.[0].value).toBe('Cannot send to [phone]')
    expect(e.breadcrumbs?.[0].message).toBe('fetch [email]')
    expect(e.breadcrumbs?.[0].data).toMatchObject({ url: '/x?token=[redacted]', body: '[redacted]' })
    expect(e.extra).toEqual({ phone: '[redacted]', note: 'ok' })
  })
})

import { parseSampleRate, sentryOptions } from './config'

describe('sentryOptions', () => {
  it('is off without a DSN and on with one', () => {
    expect(sentryOptions({}).enabled).toBe(false)
    expect(sentryOptions({ dsn: '  ' }).enabled).toBe(false)
    expect(sentryOptions({ dsn: 'https://k@o1.ingest.sentry.io/2' }).enabled).toBe(true)
  })
  it('never sends default PII and scrubs outgoing events', () => {
    const o = sentryOptions({ dsn: 'https://k@o1.ingest.sentry.io/2' })
    expect(o.sendDefaultPii).toBe(false)
    expect(o.beforeSend({ message: 'call +2348031234567' }).message).toBe('call [phone]')
  })
  it('parses the trace sample rate safely', () => {
    expect(parseSampleRate('0.25', 0.1)).toBe(0.25)
    expect(parseSampleRate('nope', 0.1)).toBe(0.1)
    expect(parseSampleRate('5', 0.1)).toBe(0.1)
    expect(parseSampleRate(undefined, 0.1)).toBe(0.1)
  })
})
