import type { NextRequest, NextResponse } from 'next/server'

// Referral attribution: a link like https://ogadesk.com/?ref=AMAKA drops this
// cookie for 30 days. Onboarding reads it into accounts.referral_code (and
// the partner program turns it into a referral later).

export const REFERRAL_COOKIE = 'ogadesk_ref'
export const REFERRAL_DAYS = 30
const PATTERN = /^[A-Za-z0-9_-]{3,32}$/

export function isValidReferralCode(value: unknown): value is string {
  return typeof value === 'string' && PATTERN.test(value)
}

/** Remember `?ref=CODE` from any page visit. Mutates and returns `response`. */
export function applyReferralCookie<T extends NextResponse>(request: NextRequest, response: T): T {
  if (request.method !== 'GET') return response
  const ref = request.nextUrl.searchParams.get('ref')
  if (!isValidReferralCode(ref)) return response
  response.cookies.set(REFERRAL_COOKIE, ref, {
    maxAge: REFERRAL_DAYS * 24 * 60 * 60,
    path: '/',
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
  })
  return response
}
