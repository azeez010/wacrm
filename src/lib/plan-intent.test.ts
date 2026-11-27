import { NextRequest, NextResponse } from 'next/server'
import { describe, expect, it } from 'vitest'
import { applyPlanIntentCookie, isValidPlanId, PLAN_INTENT_COOKIE } from './plan-intent'

const run = (url: string, method = 'GET') => applyPlanIntentCookie(new NextRequest(url, { method }), NextResponse.next())

describe('plan intent cookie', () => {
  it('remembers ?plan=ID from any page visit', () => {
    const res = run('https://ogadesk.com/signup?plan=pro')
    expect(res.cookies.get(PLAN_INTENT_COOKIE)?.value).toBe('pro')
    expect(res.cookies.get(PLAN_INTENT_COOKIE)?.maxAge).toBe(7 * 24 * 60 * 60)
  })
  it('ignores missing, malformed or hostile values and non-GET requests', () => {
    for (const bad of ['', 'Pro', 'a', '../x', 'pro plan', '<script>', 'x'.repeat(41)]) {
      expect(run(`https://ogadesk.com/?plan=${encodeURIComponent(bad)}`).cookies.get(PLAN_INTENT_COOKIE)).toBeUndefined()
    }
    expect(run('https://ogadesk.com/signup').cookies.get(PLAN_INTENT_COOKIE)).toBeUndefined()
    expect(run('https://ogadesk.com/signup?plan=pro', 'POST').cookies.get(PLAN_INTENT_COOKIE)).toBeUndefined()
  })
  it('validates plan ids', () => {
    expect(['pro', 'starter', 'growth-2', 'a1'].every(isValidPlanId)).toBe(true)
    expect(['', 'P', 'free plan', null, 5].some(isValidPlanId)).toBe(false)
  })
})
