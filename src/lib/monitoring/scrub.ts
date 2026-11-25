// ============================================================
// Keeps customer data out of Sentry. This app handles WhatsApp numbers, message
// text, contact details and API keys, none of which belongs in an error tracker.
// Pure and dependency-free, so the browser, the server and the Worker share it.
// ============================================================

const PHONE = /\+?\d[\d\s().-]{7,}\d/g
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const API_KEY = /wacrm_(?:live|test)_[A-Za-z0-9_-]+/g
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi
const WHSEC = /whsec_[A-Za-z0-9_-]+/g
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g

/** Query-string keys whose values are credentials. */
const SECRET_PARAMS = /([?&](?:key|api_key|apikey|token|access_token|secret|code|password|signature)=)[^&#\s]*/gi

/** Header / field names whose values are always dropped. */
const SENSITIVE_KEY = /^(authorization|cookie|set-cookie|x-api-key|x-cron-secret|x-wacrm-signature|x-hub-signature(-256)?|password|token|secret|access_token|refresh_token|api_key|apikey|body|message|text|phone|email|name|content)$/i

/** Strip numbers, emails, keys and tokens from free text. */
export function scrubText(input: string): string {
  return input
    .replace(SECRET_PARAMS, '$1[redacted]')
    .replace(API_KEY, '[api-key]')
    .replace(WHSEC, '[webhook-secret]')
    .replace(JWT, '[token]')
    .replace(BEARER, '$1 [redacted]')
    .replace(EMAIL, '[email]')
    .replace(PHONE, '[phone]')
}

/** Scrub a URL: credentials in the query string, plus anything number-like in the path. */
export function scrubUrl(url: string): string {
  return scrubText(url)
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return scrubText(value)
  if (depth <= 0 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth - 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : scrubValue(v, depth - 1)
  }
  return out
}

/** Minimal shape of the parts of a Sentry event we touch (avoids importing the SDK here). */
export interface ScrubbableEvent {
  message?: string
  request?: { url?: string; headers?: Record<string, unknown>; cookies?: unknown; data?: unknown; query_string?: unknown }
  user?: Record<string, unknown>
  exception?: { values?: { value?: string }[] }
  breadcrumbs?: { message?: string; data?: unknown }[]
  extra?: Record<string, unknown>
  contexts?: Record<string, unknown>
  transaction?: string
  spans?: { description?: string; data?: unknown }[]
}

/**
 * Remove personal data and credentials from an event before it is sent. Works on
 * errors and on performance transactions. Always returns the event (never drops it).
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const e = event
  if (e.message) e.message = scrubText(e.message)
  if (e.transaction) e.transaction = scrubText(e.transaction)

  for (const ex of e.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value)
  }

  if (e.request) {
    if (e.request.url) e.request.url = scrubUrl(e.request.url)
    if (typeof e.request.query_string === 'string') e.request.query_string = scrubText(e.request.query_string)
    delete e.request.cookies
    delete e.request.data // request bodies hold messages and contact details
    if (e.request.headers) e.request.headers = scrubValue(e.request.headers, 1) as Record<string, unknown>
  }

  // Keep only an opaque account/user id, never an email, name, phone or IP.
  if (e.user) {
    const id = typeof e.user.id === 'string' ? e.user.id : undefined
    e.user = id ? { id } : {}
  }

  for (const b of e.breadcrumbs ?? []) {
    if (b.message) b.message = scrubText(b.message)
    if (b.data) b.data = scrubValue(b.data, 3)
  }
  if (e.extra) e.extra = scrubValue(e.extra, 3) as Record<string, unknown>
  if (e.contexts) e.contexts = scrubValue(e.contexts, 3) as Record<string, unknown>
  for (const s of e.spans ?? []) {
    if (s.description) s.description = scrubText(s.description)
    if (s.data) s.data = scrubValue(s.data, 2)
  }
  return e
}
