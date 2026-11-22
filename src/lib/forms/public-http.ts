import { NextResponse } from 'next/server'

/** CORS for the public form endpoints: anyone may post, no credentials. */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

export function corsJson(body: unknown, status = 200, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store', ...extra } })
}

export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

/** Hash an IP with a salt that changes daily (no long-term identifier is stored). */
export async function hashIp(ip: string, now: Date = new Date()): Promise<string> {
  const day = now.toISOString().slice(0, 10)
  const data = new TextEncoder().encode(`${day}:${ip}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview|headless|curl|wget|python-requests|monitor|lighthouse/i

export function isBotUserAgent(ua: string | null | undefined): boolean {
  return !ua || BOT_RE.test(ua)
}

export function deviceFromUserAgent(ua: string | null | undefined): 'mobile' | 'tablet' | 'desktop' | null {
  if (!ua) return null
  if (/ipad|tablet/i.test(ua)) return 'tablet'
  if (/mobi|android|iphone/i.test(ua)) return 'mobile'
  return 'desktop'
}

/** Verify a Cloudflare Turnstile token (only called when the form asks for it and a secret is set). */
export async function verifyTurnstile(token: string | undefined, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return true // not configured: do not lock everyone out
  if (!token) return false
  try {
    const body = new URLSearchParams({ secret, response: token })
    if (ip) body.set('remoteip', ip)
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
    const json = (await res.json()) as { success?: boolean }
    return json.success === true
  } catch {
    return true // fail open: a Cloudflare hiccup must not reject leads
  }
}
