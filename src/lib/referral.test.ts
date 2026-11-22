import { describe, expect, it } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { REFERRAL_COOKIE, applyReferralCookie, isValidReferralCode } from './referral'

const run = (url: string, method = 'GET') => applyReferralCookie(new NextRequest(url, { method }), NextResponse.next())

describe('referral cookie', () => {
  it('remembers a valid ?ref= for 30 days', () => {
    const c = run('https://ogadesk.com/?ref=AMAKA_01').cookies.get(REFERRAL_COOKIE)
    expect(c).toMatchObject({ value: 'AMAKA_01', path: '/', maxAge: 30 * 86400, sameSite: 'lax', secure: true })
  })

  it('ignores missing, malformed or non-GET refs', () => {
    expect(run('https://ogadesk.com/').cookies.get(REFERRAL_COOKIE)).toBeUndefined()
    for (const bad of ['ab', 'has space', 'x'.repeat(33), '<script>', 'a/b']) {
      expect(run(`https://ogadesk.com/?ref=${encodeURIComponent(bad)}`).cookies.get(REFERRAL_COOKIE)).toBeUndefined()
    }
    expect(run('https://ogadesk.com/?ref=AMAKA', 'POST').cookies.get(REFERRAL_COOKIE)).toBeUndefined()
  })

  it('validates codes', () => {
    expect(isValidReferralCode('abc')).toBe(true)
    expect(isValidReferralCode('ab')).toBe(false)
    expect(isValidReferralCode(undefined)).toBe(false)
  })
})
