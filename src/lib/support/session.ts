// "Open as this business" support sessions (admin console → migration 130).
// The throwaway login carries its session details in app_metadata, which only the service role can set.
import type { User } from '@supabase/supabase-js'

export const SUPPORT_EMAIL_DOMAIN = 'support.ogadesk.invalid'

export interface SupportInfo {
  sessionId: string
  admin: string
  readOnly: boolean
  expiresAt: number
}

export function supportInfo(user: Pick<User, 'app_metadata'> | null | undefined): SupportInfo | null {
  const m = user?.app_metadata as Record<string, unknown> | undefined
  if (!m || typeof m.support_session !== 'string') return null
  const exp = Date.parse(String(m.support_expires_at ?? ''))
  return {
    sessionId: m.support_session,
    admin: typeof m.support_admin === 'string' ? m.support_admin : 'OgaDesk support',
    readOnly: m.support_read_only !== false,
    expiresAt: Number.isFinite(exp) ? exp : 0,
  }
}

/** What the middleware does with a request from a support login. */
export function supportGate(info: SupportInfo | null, method: string, pathname: string, now = Date.now()): 'allow' | 'expired' | 'read_only' {
  if (!info) return 'allow'
  if (pathname.startsWith('/api/support/') || pathname.startsWith('/support/')) return 'allow'
  if (info.expiresAt <= now) return 'expired'
  if (info.readOnly && !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return 'read_only'
  return 'allow'
}

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('')
}
