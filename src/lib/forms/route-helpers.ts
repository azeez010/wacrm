import { planLimitResponse } from '@/lib/billing/plan-limit-response'
import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { FeatureLockedError, PlanLimitError } from '@/lib/billing/entitlements'
import { FormError } from './server'

/** Map the errors the form routes can throw onto HTTP responses. */
export function formErrorResponse(err: unknown): NextResponse {
  const limit = planLimitResponse(err)
  if (limit) return limit
  if (err instanceof FormError) return NextResponse.json({ error: err.message }, { status: err.status })
  if (err instanceof PlanLimitError || err instanceof FeatureLockedError) {
    return NextResponse.json({ error: err.message, code: 'plan_limit' }, { status: 402 })
  }
  return toErrorResponse(err)
}
