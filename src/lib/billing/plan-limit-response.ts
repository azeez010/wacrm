// Server side: a database plan-limit refusal ('plan_limit:<key>:<n>', from the limit triggers) as the 402 the app's
// upgrade dialog understands, with a readable sentence instead of the raw text. null when it is not a plan limit.
import { NextResponse } from 'next/server'

import { parsePlanLimit } from './plan-limit'
import { LIMIT_DEFS, type LimitKey } from './plans'

export function planLimitMessage(limitKey: LimitKey | null, limit: number | null): string {
  if (!limitKey || limit === null || !(limitKey in LIMIT_DEFS)) return 'You have reached a limit of your plan. Upgrade to add more.'
  return `Your plan allows ${limit} ${LIMIT_DEFS[limitKey].toLowerCase()}. Upgrade to add more.`
}

export function planLimitResponse(err: unknown): NextResponse | null {
  if (err === null || (typeof err !== 'object' && typeof err !== 'string')) return null
  const hit = parsePlanLimit(err)
  if (!hit?.limitKey) return null
  return NextResponse.json(
    { error: planLimitMessage(hit.limitKey, hit.limit), code: 'plan_limit', limit_key: hit.limitKey, limit: hit.limit },
    { status: 402 }
  )
}
