import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import type { AccountRole } from '@/lib/auth/roles'
import type { Ctx, Result } from './server'

/** Resolve the caller (with a minimum role) into a service-role Ctx. */
export async function resolveCtx(min?: AccountRole): Promise<Ctx | NextResponse> {
  try {
    const a = min ? await requireRole(min) : await getCurrentAccount()
    return { db: supabaseAdmin(), accountId: a.accountId, userId: a.userId, role: a.role }
  } catch (err) {
    return toErrorResponse(err)
  }
}

export function isResponse(v: Ctx | NextResponse): v is NextResponse {
  return v instanceof NextResponse
}

export function respond<T>(result: Result<T>, key: string, status = 200): NextResponse {
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ [key]: result.data }, { status })
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null
}

export const badJson = () => NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
