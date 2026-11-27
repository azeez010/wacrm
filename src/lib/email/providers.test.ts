import { describe, expect, it, vi } from 'vitest'
import { EMAIL_TYPES, EmailSendError, emailType, sendVia, sendWithFailover, sigv4, type EmailInstance, type PlatformEmail } from './providers'

const MSG: PlatformEmail = {
  to: { email: 'ada@example.com', name: 'Ada "Lovelace"' },
  from: { email: 'hello@ogadesk.com', name: 'OgaDesk' },
  replyTo: 'support@ogadesk.com',
  subject: 'Welcome',
  html: '<p>Hi</p>',
  text: 'Hi',
  tags: ['welcome', 'quota 80%'],
}

type Call = { url: string; init: RequestInit }
function fakeFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> } | Error>) {
  const calls: Call[] = []
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const r = responses.shift()
    if (!r) throw new Error('no more responses')
    if (r instanceof Error) throw r
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status, headers: r.headers })
  }) as unknown as typeof fetch
  return { f, calls }
}
const inst = (kind: string, secrets: Record<string, string>, config: Record<string, unknown> = {}): EmailInstance => ({ id: `i-${kind}`, kind, config, secrets })
const bodyOf = (c: Call) => JSON.parse(String(c.init.body))
const header = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k]

describe('catalogue', () => {
  it('has the six providers, each with a required secret and the sender override', () => {
    expect(EMAIL_TYPES.map((t) => t.kind)).toEqual(['brevo', 'resend', 'sendgrid', 'postmark', 'mailgun', 'ses'])
    for (const t of EMAIL_TYPES) {
      expect(t.fields.some((f) => f.type === 'secret' && f.required)).toBe(true)
      expect(t.fields.map((f) => f.key)).toEqual(expect.arrayContaining(['from_address', 'from_name']))
      for (const f of t.fields) if (f.pattern) expect(() => new RegExp(f.pattern!)).not.toThrow()
    }
    expect(emailType('nope')).toBeUndefined()
  })
})

describe('adapters', () => {
  it('Brevo', async () => {
    const { f, calls } = fakeFetch([{ status: 201, body: { messageId: '<m1>' } }])
    expect(await sendVia(inst('brevo', { api_key: 'xkeysib-1' }), MSG, f)).toEqual({ id: '<m1>' })
    expect(calls[0]!.url).toBe('https://api.brevo.com/v3/smtp/email')
    expect(header(calls[0]!, 'api-key')).toBe('xkeysib-1')
    expect(bodyOf(calls[0]!)).toMatchObject({ sender: { email: 'hello@ogadesk.com', name: 'OgaDesk' }, to: [{ email: 'ada@example.com', name: 'Ada Lovelace' }], replyTo: { email: 'support@ogadesk.com' }, textContent: 'Hi' })
  })

  it('Resend, with the per-instance sender override and safe tags', async () => {
    const { f, calls } = fakeFetch([{ status: 200, body: { id: 'r1' } }])
    await sendVia(inst('resend', { api_key: 're_1' }, { from_address: 'mail@send.ogadesk.com', from_name: 'Oga' }), MSG, f)
    const b = bodyOf(calls[0]!)
    expect(header(calls[0]!, 'authorization')).toBe('Bearer re_1')
    expect(b.from).toBe('"Oga" <mail@send.ogadesk.com>')
    expect(b.tags).toEqual([{ name: 'tag0', value: 'welcome' }, { name: 'tag1', value: 'quota_80_' }])
  })

  it('SendGrid EU, message id from the header', async () => {
    const { f, calls } = fakeFetch([{ status: 202, headers: { 'x-message-id': 'sg1' } }])
    expect(await sendVia(inst('sendgrid', { api_key: 'SG.x' }, { region: 'eu' }), MSG, f)).toEqual({ id: 'sg1' })
    expect(calls[0]!.url).toBe('https://api.eu.sendgrid.com/v3/mail/send')
    expect(bodyOf(calls[0]!).content).toEqual([{ type: 'text/plain', value: 'Hi' }, { type: 'text/html', value: '<p>Hi</p>' }])
  })

  it('Postmark', async () => {
    const { f, calls } = fakeFetch([{ status: 200, body: { MessageID: 'p1', ErrorCode: 0 } }])
    await sendVia(inst('postmark', { server_token: 'tok' }), MSG, f)
    expect(header(calls[0]!, 'x-postmark-server-token')).toBe('tok')
    expect(bodyOf(calls[0]!)).toMatchObject({ MessageStream: 'outbound', Tag: 'welcome', To: '"Ada Lovelace" <ada@example.com>' })
  })

  it('Mailgun EU, form encoded with basic auth', async () => {
    const { f, calls } = fakeFetch([{ status: 200, body: { id: '<mg1>' } }])
    await sendVia(inst('mailgun', { api_key: 'key-1' }, { domain: 'mg.ogadesk.com', region: 'eu' }), MSG, f)
    expect(calls[0]!.url).toBe('https://api.eu.mailgun.net/v3/mg.ogadesk.com/messages')
    expect(header(calls[0]!, 'authorization')).toBe(`Basic ${btoa('api:key-1')}`)
    const form = new URLSearchParams(String(calls[0]!.init.body))
    expect(form.getAll('o:tag')).toEqual(['welcome', 'quota_80_'])
    expect(form.get('h:Reply-To')).toBe('support@ogadesk.com')
  })

  it('Amazon SES v2, signed', async () => {
    const { f, calls } = fakeFetch([{ status: 200, body: { MessageId: 's1' } }])
    const out = await sendVia(inst('ses', { access_key_id: 'AKIAEXAMPLE12345', secret_access_key: 'secret' }, { region: 'eu-west-1' }), MSG, f, () => new Date('2026-11-27T10:00:00Z'))
    expect(out).toEqual({ id: 's1' })
    expect(calls[0]!.url).toBe('https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails')
    expect(header(calls[0]!, 'x-amz-date')).toBe('20261127T100000Z')
    expect(header(calls[0]!, 'authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE12345\/20261127\/eu-west-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/)
    expect(bodyOf(calls[0]!).Content.Simple.Body.Html.Data).toBe('<p>Hi</p>')
  })

  it('classifies errors: 429/5xx/network retryable, 4xx not', async () => {
    const run = async (r: { status: number; body?: unknown } | Error) => {
      const { f } = fakeFetch([r])
      return sendVia(inst('resend', { api_key: 're_1' }), MSG, f).then(() => null, (e: EmailSendError) => e)
    }
    expect((await run({ status: 429, body: { message: 'slow down' } }))!.retryable).toBe(true)
    expect((await run({ status: 503 }))!.retryable).toBe(true)
    expect((await run(new TypeError('fetch failed')))!.retryable).toBe(true)
    const bad = (await run({ status: 422, body: { message: 'domain not verified' } }))!
    expect(bad.retryable).toBe(false)
    expect(bad.message).toContain('domain not verified')
  })

  it('refuses without a secret or a sender', async () => {
    const { f } = fakeFetch([])
    await expect(sendVia(inst('brevo', {}), MSG, f)).rejects.toMatchObject({ retryable: false })
    await expect(sendVia(inst('brevo', { api_key: 'k' }), { ...MSG, from: { email: '' } }, f)).rejects.toThrow(/sender/)
  })
})

describe('sendWithFailover', () => {
  it('moves to the next provider on any error and reports each attempt', async () => {
    const { f, calls } = fakeFetch([{ status: 401, body: { message: 'bad key' } }, { status: 200, body: { id: 'r2' } }])
    const report = vi.fn()
    const out = await sendWithFailover([inst('brevo', { api_key: 'k' }), inst('resend', { api_key: 're_1' })], MSG, { fetch: f, report })
    expect(out).toMatchObject({ ok: true, instanceId: 'i-resend', messageId: 'r2' })
    expect(calls).toHaveLength(2)
    expect(report.mock.calls).toEqual([['i-brevo', false, 'Brevo: bad key'], ['i-resend', true]])
  })

  it('fails when all fail; retryable only if one failure was temporary', async () => {
    const perm = await sendWithFailover([inst('resend', { api_key: 'x' })], MSG, { fetch: fakeFetch([{ status: 403 }]).f })
    expect(perm).toMatchObject({ ok: false, retryable: false })
    const temp = await sendWithFailover([inst('resend', { api_key: 'x' }), inst('brevo', { api_key: 'y' })], MSG, { fetch: fakeFetch([{ status: 403 }, { status: 500 }]).f })
    expect(temp).toMatchObject({ ok: false, retryable: true })
    expect(await sendWithFailover([], MSG)).toMatchObject({ ok: false, retryable: false })
  })
})

describe('sigv4', () => {
  // AWS Signature Version 4 test suite, "get-vanilla".
  it('matches the published test vector', async () => {
    const auth = await sigv4(
      { method: 'GET', path: '/', query: '', headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' }, body: '' },
      { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service' },
    )
    expect(auth).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31')
  })
})
