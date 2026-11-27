import type { NextRequest, NextResponse } from 'next/server'

// Which plan a visitor clicked on the pricing page. A link like /signup?plan=pro drops this cookie so the choice
// survives email confirmation and Google sign-in; onboarding reads it to start that plan's free trial.
// It is only a hint: the plan is validated server-side (active, has trial days) before anything is granted.

export const PLAN_INTENT_COOKIE = 'ogadesk_plan'
export const PLAN_INTENT_DAYS = 7
const PATTERN = /^[a-z0-9][a-z0-9_-]{1,39}$/

export function isValidPlanId(value: unknown): value is string {
  return typeof value === 'string' && PATTERN.test(value)
}

/** Remember `?plan=ID` from any page visit. Mutates and returns `response`. */
export function applyPlanIntentCookie<T extends NextResponse>(request: NextRequest, response: T): T {
  if (request.method !== 'GET') return response
  const plan = request.nextUrl.searchParams.get('plan')
  if (!isValidPlanId(plan)) return response
  response.cookies.set(PLAN_INTENT_COOKIE, plan, {
    maxAge: PLAN_INTENT_DAYS * 24 * 60 * 60,
    path: '/',
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
  })
  return response
}
