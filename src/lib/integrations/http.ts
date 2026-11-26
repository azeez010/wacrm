import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { FeatureLockedError, PlanLimitError } from '@/lib/billing/entitlements'
import { BlockedUrlError } from '@/lib/ai/tools/guarded-fetch'
import { IntegrationInputError } from './manage'

/** Shared error mapping for /api/integrations/*. */
export function integrationError(err: unknown, where: string): NextResponse {
  if (err instanceof PlanLimitError || err instanceof FeatureLockedError) return NextResponse.json({ error: err.message, upgrade: true }, { status: 402 })
  if (err instanceof IntegrationInputError || err instanceof BlockedUrlError) return NextResponse.json({ error: err.message }, { status: 400 })
  const res = toErrorResponse(err)
  if (res.status >= 500) console.error(`[${where}]`, err)
  return res
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const body = (await request.json().catch(() => null)) as unknown
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}
