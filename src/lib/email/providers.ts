// ============================================================
// Platform email providers: the catalogue (what the admin fills in) and one adapter per provider, plus failover.
// Pure: no imports, fetch + Web Crypto only, so it runs on Workers and Node. The admin API and the admin console keep
// byte-identical copies (ogadesk-api/src/lib/email-providers.ts, ogadesk-admin/src/lib/email-providers.ts, drift-tested).
// Adding a provider = one entry in EMAIL_TYPES + one case in sendVia().
// ============================================================

export type EmailFieldType = 'text' | 'secret' | 'select'
export interface EmailFieldDef {
  key: string
  label: string
  type: EmailFieldType
  required?: boolean
  help?: string
  placeholder?: string
  options?: { value: string; label: string }[]
  default?: string
  /** Regex a value must match (a string so it survives JSON). */
  pattern?: string
}

export interface EmailTypeDef {
  kind: string
  label: string
  description: string
  docsUrl: string
  fields: EmailFieldDef[]
}

const EMAIL_PATTERN = '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'
// Every type can override the default sender (providers only send from addresses/domains verified with them).
const SENDER_FIELDS: EmailFieldDef[] = [
  { key: 'from_address', label: 'From address', type: 'text', pattern: EMAIL_PATTERN, placeholder: 'hello@ogadesk.com', help: 'Leave blank to use the default sender. Must be verified with this provider.' },
  { key: 'from_name', label: 'From name', type: 'text', placeholder: 'OgaDesk', help: 'Leave blank to use the default sender name.' },
]

export const EMAIL_TYPES: EmailTypeDef[] = [
  {
    kind: 'brevo', label: 'Brevo', description: 'Transactional email through Brevo (formerly Sendinblue).', docsUrl: 'https://developers.brevo.com/reference/sendtransacemail',
    fields: [{ key: 'api_key', label: 'API key', type: 'secret', required: true, pattern: '^xkeysib-', help: 'Brevo → SMTP & API → API keys (starts with xkeysib-).' }, ...SENDER_FIELDS],
  },
  {
    kind: 'resend', label: 'Resend', description: 'Transactional email through Resend.', docsUrl: 'https://resend.com/docs/api-reference/emails/send-email',
    fields: [{ key: 'api_key', label: 'API key', type: 'secret', required: true, pattern: '^re_', help: 'Resend → API Keys (starts with re_), with sending access.' }, ...SENDER_FIELDS],
  },
  {
    kind: 'sendgrid', label: 'SendGrid', description: 'Transactional email through Twilio SendGrid.', docsUrl: 'https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send',
    fields: [
      { key: 'api_key', label: 'API key', type: 'secret', required: true, pattern: '^SG\\.', help: 'SendGrid → Settings → API Keys (starts with SG.), with Mail Send access.' },
      { key: 'region', label: 'Region', type: 'select', default: 'global', options: [{ value: 'global', label: 'Global' }, { value: 'eu', label: 'EU (regional subuser)' }] },
      ...SENDER_FIELDS,
    ],
  },
  {
    kind: 'postmark', label: 'Postmark', description: 'Transactional email through Postmark.', docsUrl: 'https://postmarkapp.com/developer/api/email-api',
    fields: [
      { key: 'server_token', label: 'Server API token', type: 'secret', required: true, help: 'Postmark → your server → API Tokens.' },
      { key: 'message_stream', label: 'Message stream', type: 'text', default: 'outbound', placeholder: 'outbound' },
      ...SENDER_FIELDS,
    ],
  },
  {
    kind: 'mailgun', label: 'Mailgun', description: 'Transactional email through Mailgun.', docsUrl: 'https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages',
    fields: [
      { key: 'api_key', label: 'API key', type: 'secret', required: true, help: 'Mailgun → API Security → sending or private API key.' },
      { key: 'domain', label: 'Sending domain', type: 'text', required: true, pattern: '^[a-z0-9.-]+\\.[a-z]{2,}$', placeholder: 'mg.ogadesk.com' },
      { key: 'region', label: 'Region', type: 'select', default: 'us', options: [{ value: 'us', label: 'US' }, { value: 'eu', label: 'EU' }] },
      ...SENDER_FIELDS,
    ],
  },
  {
    kind: 'ses', label: 'Amazon SES', description: 'Transactional email through Amazon Simple Email Service (v2 API).', docsUrl: 'https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html',
    fields: [
      { key: 'access_key_id', label: 'Access key ID', type: 'secret', required: true, pattern: '^[A-Z0-9]{16,128}$', help: 'An IAM user allowed ses:SendEmail.' },
      { key: 'secret_access_key', label: 'Secret access key', type: 'secret', required: true },
      { key: 'region', label: 'Region', type: 'text', required: true, pattern: '^[a-z]{2}(-[a-z]+)+-\\d$', placeholder: 'eu-west-1' },
      { key: 'configuration_set', label: 'Configuration set', type: 'text', help: 'Optional.' },
      ...SENDER_FIELDS,
    ],
  },
]

export const emailType = (kind: string): EmailTypeDef | undefined => EMAIL_TYPES.find((t) => t.kind === kind)

// ---------------------------------------------------------------- sending

export interface Address {
  email: string
  name?: string
}

export interface PlatformEmail {
  to: Address
  from: Address
  replyTo?: string | null
  subject: string
  html: string
  text: string
  tags?: string[]
}

export interface EmailInstance {
  id: string
  kind: string
  name?: string
  config: Record<string, unknown>
  secrets: Record<string, string>
}

/** `retryable`: trying again later can help (network, 429, 5xx). Otherwise the request itself was refused. */
export class EmailSendError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number) {
    super(message)
    this.name = 'EmailSendError'
  }
}

type Fetch = typeof fetch
const TIMEOUT_MS = 15_000
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const cleanName = (n?: string) => (n ?? '').replace(/["\\\r\n<>]/g, '').trim()
const formatAddress = (a: Address) => (cleanName(a.name) ? `"${cleanName(a.name)}" <${a.email}>` : a.email)
const tagValue = (t: string) => t.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)

function errorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return typeof body === 'string' && body ? body.slice(0, 200) : null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as Record<string, any>
  return str(b.message) || str(b.Message) || str(b.error?.message) || str(b.errors?.[0]?.message) || str(b.error) || null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(f: Fetch, label: string, url: string, init: RequestInit): Promise<{ body: any; headers: Headers }> {
  let res: Response
  try {
    res = await f(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    throw new EmailSendError(`${label}: could not reach the provider (${e instanceof Error ? e.message : 'network error'})`, true)
  }
  const raw = await res.text().catch(() => '')
  let body: unknown = raw
  try { body = raw ? JSON.parse(raw) : null } catch { /* keep text */ }
  if (!res.ok) {
    throw new EmailSendError(`${label}: ${errorMessage(body) ?? `HTTP ${res.status}`}`.slice(0, 300), res.status === 429 || res.status >= 500, res.status)
  }
  return { body, headers: res.headers }
}

function need(secrets: Record<string, string>, key: string, label: string): string {
  const v = str(secrets[key])
  if (!v) throw new EmailSendError(`${label}: missing ${key}`, false)
  return v
}

/** Sends through one instance. Returns the provider's message id when it gives one. */
export async function sendVia(inst: EmailInstance, msg: PlatformEmail, f: Fetch = fetch, now: () => Date = () => new Date()): Promise<{ id?: string }> {
  const t = emailType(inst.kind)
  if (!t) throw new EmailSendError(`Unknown email provider "${inst.kind}"`, false)
  const label = inst.name || t.label
  const c = inst.config ?? {}
  const from: Address = { email: str(c.from_address) || msg.from.email, name: str(c.from_name) || msg.from.name }
  if (!from.email) throw new EmailSendError(`${label}: no sender address (set the default sender in Platform settings → Email)`, false)
  const tags = (msg.tags ?? []).filter(Boolean).slice(0, 5)
  const json = { 'content-type': 'application/json', accept: 'application/json' }

  switch (t.kind) {
    case 'brevo': {
      const { body } = await call(f, label, 'https://api.brevo.com/v3/smtp/email', {
        method: 'POST', headers: { ...json, 'api-key': need(inst.secrets, 'api_key', label) },
        body: JSON.stringify({
          sender: { email: from.email, ...(cleanName(from.name) ? { name: cleanName(from.name) } : {}) },
          to: [{ email: msg.to.email, ...(cleanName(msg.to.name) ? { name: cleanName(msg.to.name) } : {}) }],
          subject: msg.subject, htmlContent: msg.html || msg.text, textContent: msg.text,
          ...(msg.replyTo ? { replyTo: { email: msg.replyTo } } : {}), ...(tags.length ? { tags } : {}),
        }),
      })
      return { id: body?.messageId }
    }
    case 'resend': {
      const { body } = await call(f, label, 'https://api.resend.com/emails', {
        method: 'POST', headers: { ...json, authorization: `Bearer ${need(inst.secrets, 'api_key', label)}` },
        body: JSON.stringify({
          from: formatAddress(from), to: [msg.to.email], subject: msg.subject, html: msg.html || undefined, text: msg.text,
          ...(msg.replyTo ? { reply_to: msg.replyTo } : {}), ...(tags.length ? { tags: tags.map((v, i) => ({ name: `tag${i}`, value: tagValue(v) })) } : {}),
        }),
      })
      return { id: body?.id }
    }
    case 'sendgrid': {
      const host = str(c.region) === 'eu' ? 'https://api.eu.sendgrid.com' : 'https://api.sendgrid.com'
      const { headers } = await call(f, label, `${host}/v3/mail/send`, {
        method: 'POST', headers: { ...json, authorization: `Bearer ${need(inst.secrets, 'api_key', label)}` },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: msg.to.email, ...(cleanName(msg.to.name) ? { name: cleanName(msg.to.name) } : {}) }] }],
          from: { email: from.email, ...(cleanName(from.name) ? { name: cleanName(from.name) } : {}) },
          ...(msg.replyTo ? { reply_to: { email: msg.replyTo } } : {}),
          subject: msg.subject,
          content: [{ type: 'text/plain', value: msg.text || ' ' }, ...(msg.html ? [{ type: 'text/html', value: msg.html }] : [])],
          ...(tags.length ? { categories: tags.map(tagValue) } : {}),
        }),
      })
      return { id: headers.get('x-message-id') ?? undefined }
    }
    case 'postmark': {
      const { body } = await call(f, label, 'https://api.postmarkapp.com/email', {
        method: 'POST', headers: { ...json, 'x-postmark-server-token': need(inst.secrets, 'server_token', label) },
        body: JSON.stringify({
          From: formatAddress(from), To: formatAddress(msg.to), Subject: msg.subject, HtmlBody: msg.html || undefined, TextBody: msg.text,
          MessageStream: str(c.message_stream) || 'outbound', ...(msg.replyTo ? { ReplyTo: msg.replyTo } : {}), ...(tags[0] ? { Tag: tagValue(tags[0]) } : {}),
        }),
      })
      return { id: body?.MessageID }
    }
    case 'mailgun': {
      const domain = str(c.domain)
      if (!domain) throw new EmailSendError(`${label}: missing sending domain`, false)
      const host = str(c.region) === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net'
      const form = new URLSearchParams({ from: formatAddress(from), to: formatAddress(msg.to), subject: msg.subject, text: msg.text })
      if (msg.html) form.set('html', msg.html)
      if (msg.replyTo) form.set('h:Reply-To', msg.replyTo)
      for (const tg of tags) form.append('o:tag', tagValue(tg))
      const { body } = await call(f, label, `${host}/v3/${encodeURIComponent(domain)}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', authorization: `Basic ${btoa(`api:${need(inst.secrets, 'api_key', label)}`)}` },
        body: form.toString(),
      })
      return { id: body?.id }
    }
    case 'ses': {
      const region = str(c.region)
      if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) throw new EmailSendError(`${label}: invalid region`, false)
      const host = `email.${region}.amazonaws.com`
      const path = '/v2/email/outbound-emails'
      const payload = JSON.stringify({
        FromEmailAddress: formatAddress(from),
        Destination: { ToAddresses: [formatAddress(msg.to)] },
        ...(msg.replyTo ? { ReplyToAddresses: [msg.replyTo] } : {}),
        Content: { Simple: {
          Subject: { Data: msg.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: msg.text, Charset: 'UTF-8' }, ...(msg.html ? { Html: { Data: msg.html, Charset: 'UTF-8' } } : {}) },
        } },
        ...(tags.length ? { EmailTags: tags.map((v, i) => ({ Name: `tag${i}`, Value: tagValue(v) })) } : {}),
        ...(str(c.configuration_set) ? { ConfigurationSetName: str(c.configuration_set) } : {}),
      })
      const amzDate = now().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
      const headers: Record<string, string> = { 'content-type': 'application/json', host, 'x-amz-date': amzDate }
      headers.authorization = await sigv4(
        { method: 'POST', path, query: '', headers, body: payload },
        { accessKeyId: need(inst.secrets, 'access_key_id', label), secretAccessKey: need(inst.secrets, 'secret_access_key', label), region, service: 'ses' },
      )
      delete headers.host // fetch sets it
      const { body } = await call(f, label, `https://${host}${path}`, { method: 'POST', headers, body: payload })
      return { id: body?.MessageId }
    }
  }
  throw new EmailSendError(`${label}: provider "${t.kind}" has no sender`, false)
}

export interface Attempt {
  instanceId: string
  kind: string
  ok: boolean
  error?: string
  retryable?: boolean
}

export type FailoverResult =
  | { ok: true; instanceId: string; messageId?: string; attempts: Attempt[] }
  | { ok: false; retryable: boolean; error: string; attempts: Attempt[] }

/**
 * Tries each instance in order and stops at the first that accepts the email. Any error moves on to the next one (a bad
 * key on one provider must not block the others). Overall `retryable` is true when at least one failure was temporary.
 */
export async function sendWithFailover(
  instances: EmailInstance[],
  msg: PlatformEmail,
  opts: { fetch?: Fetch; report?: (instanceId: string, ok: boolean, error?: string) => Promise<void> | void } = {},
): Promise<FailoverResult> {
  const attempts: Attempt[] = []
  if (instances.length === 0) return { ok: false, retryable: false, error: 'No email provider is set up.', attempts }
  for (const inst of instances) {
    try {
      const r = await sendVia(inst, msg, opts.fetch ?? fetch)
      attempts.push({ instanceId: inst.id, kind: inst.kind, ok: true })
      await Promise.resolve(opts.report?.(inst.id, true)).catch(() => undefined)
      return { ok: true, instanceId: inst.id, messageId: r.id, attempts }
    } catch (e) {
      const err = e instanceof EmailSendError ? e : new EmailSendError(e instanceof Error ? e.message : 'send failed', true)
      attempts.push({ instanceId: inst.id, kind: inst.kind, ok: false, error: err.message, retryable: err.retryable })
      await Promise.resolve(opts.report?.(inst.id, false, err.message)).catch(() => undefined)
    }
  }
  return { ok: false, retryable: attempts.some((a) => a.retryable), error: attempts.map((a) => a.error).join(' | ').slice(0, 500), attempts }
}

// ---------------------------------------------------------------- AWS Signature Version 4 (Web Crypto)

const enc = new TextEncoder()
const toHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha256Hex = async (s: string) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, enc.encode(data))
}

/** The Authorization header for a request. `headers` must include host and x-amz-date (YYYYMMDDTHHMMSSZ). */
export async function sigv4(
  req: { method: string; path: string; query: string; headers: Record<string, string>; body: string },
  cred: { accessKeyId: string; secretAccessKey: string; region: string; service: string },
): Promise<string> {
  const lower = Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const).sort(([a], [b]) => (a < b ? -1 : 1))
  const signedHeaders = lower.map(([k]) => k).join(';')
  const amzDate = lower.find(([k]) => k === 'x-amz-date')?.[1] ?? ''
  const day = amzDate.slice(0, 8)
  const canonical = [req.method, req.path, req.query, lower.map(([k, v]) => `${k}:${v}\n`).join(''), signedHeaders, await sha256Hex(req.body)].join('\n')
  const scope = `${day}/${cred.region}/${cred.service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonical)].join('\n')
  const kDate = await hmac(enc.encode(`AWS4${cred.secretAccessKey}`), day)
  const kRegion = await hmac(kDate, cred.region)
  const kService = await hmac(kRegion, cred.service)
  const kSigning = await hmac(kService, 'aws4_request')
  const signature = toHex(await hmac(kSigning, toSign))
  return `AWS4-HMAC-SHA256 Credential=${cred.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}
