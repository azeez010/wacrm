import { guardedFetch } from '../guarded-fetch'

// A business-defined HTTP action: the AI fills the declared fields; we call the URL.
//   GET/DELETE: fields go in the query string.  POST/PUT/PATCH: fields go in a JSON body.
//   {{field}} in the URL path is replaced (URL-encoded). Header values come from the integration's encrypted secrets.

export interface HttpActionConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  /** Header names whose values are secrets (stored encrypted on the integration). */
  headerNames?: string[]
}

export function buildRequest(cfg: HttpActionConfig, args: Record<string, unknown>): { url: string; body: string | null } {
  const used = new Set<string>()
  let url = cfg.url.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, k: string) => {
    used.add(k)
    const v = args[k]
    return encodeURIComponent(v === undefined || v === null ? '' : String(v))
  })
  const rest = Object.fromEntries(Object.entries(args).filter(([k]) => !used.has(k)))
  if (cfg.method === 'GET' || cfg.method === 'DELETE') {
    const u = new URL(url)
    for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
    url = u.toString()
    return { url, body: null }
  }
  return { url, body: JSON.stringify(rest) }
}

export async function runHttpAction(
  cfg: HttpActionConfig,
  headers: Record<string, string>,
  args: Record<string, unknown>,
  deps: { fetch?: typeof fetch; check?: (u: string) => Promise<URL> } = {},
): Promise<{ text: string; isError: boolean }> {
  const req = buildRequest(cfg, args)
  const res = await guardedFetch(
    req.url,
    { method: cfg.method, headers: { Accept: 'application/json, text/plain;q=0.9', ...(req.body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: req.body ?? undefined, timeoutMs: 10_000 },
    deps,
  )
  return { text: `HTTP ${res.status}\n${res.text}`, isError: res.status >= 400 }
}
