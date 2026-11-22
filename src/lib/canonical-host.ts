// ============================================================
// Canonical host. The product lives at ogadesk.com. Older addresses keep
// answering so nothing already shared or configured breaks, but page visits
// are sent to the canonical host (permanent redirect). API routes are never
// redirected: Meta webhooks and API clients don't reliably follow redirects
// and still point at the old host until they are updated.
// ============================================================

export const CANONICAL_ORIGIN = 'https://ogadesk.com'

const REDIRECT_HOSTS = new Set([
  'www.ogadesk.com',
  'ogadesk.dataslid.com.ng',
  'wacrm.dataslid.com.ng',
])

/** The URL to send this request to, or null when it should be served as is. */
export function canonicalRedirect(host: string | null, method: string, pathname: string, search: string): string | null {
  if (!host) return null
  const hostname = host.toLowerCase().split(':')[0]
  if (!REDIRECT_HOSTS.has(hostname)) return null
  if (method !== 'GET' && method !== 'HEAD') return null
  if (pathname === '/api' || pathname.startsWith('/api/')) return null
  return `${CANONICAL_ORIGIN}${pathname}${search}`
}
