import { isDeliverableUrl } from '@/lib/webhooks/ssrf'

// Outbound calls to URLs a BUSINESS typed (MCP servers, HTTP actions): https only, public hosts only (SSRF guard), no
// redirects (a redirect could point at an internal host), a timeout, and a response size cap. Workers also enforce
// global_fetch_strictly_public; this is the in-app layer.

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedUrlError'
  }
}

export const MAX_RESPONSE_BYTES = 512 * 1024

export async function assertPublicHttps(raw: string): Promise<URL> {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new BlockedUrlError('That is not a valid URL.')
  }
  if (u.protocol !== 'https:') throw new BlockedUrlError('The URL must start with https://')
  if (u.username || u.password) throw new BlockedUrlError('Put credentials in a header, not in the URL.')
  let ok = false
  try {
    ok = await isDeliverableUrl(u.toString())
  } catch {
    ok = false
  }
  if (!ok) throw new BlockedUrlError('That address is private or cannot be reached from the internet.')
  return u
}

export interface GuardedResponse {
  status: number
  headers: Headers
  text: string
}

export async function guardedFetch(
  raw: string,
  init: RequestInit & { timeoutMs?: number },
  deps: { fetch?: typeof fetch; check?: (u: string) => Promise<URL> } = {},
): Promise<GuardedResponse> {
  const url = await (deps.check ?? assertPublicHttps)(raw)
  const { timeoutMs = 10_000, ...rest } = init
  const res = await (deps.fetch ?? fetch)(url.toString(), { ...rest, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
  if (res.status >= 300 && res.status < 400) throw new BlockedUrlError(`The server answered with a redirect (${res.status}); redirects are not followed.`)
  const reader = res.body?.getReader()
  if (!reader) return { status: res.status, headers: res.headers, text: '' }
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new BlockedUrlError('The response is too large.')
    }
    chunks.push(value)
  }
  const buf = new Uint8Array(size)
  let o = 0
  for (const c of chunks) {
    buf.set(c, o)
    o += c.byteLength
  }
  return { status: res.status, headers: res.headers, text: new TextDecoder().decode(buf) }
}
