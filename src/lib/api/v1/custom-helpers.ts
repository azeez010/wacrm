import type { ApiKeyContext } from '@/lib/auth/api-context'
import type { Ctx } from '@/lib/custom-fields/server'
import type { SegCtx } from '@/lib/segments/server'
import { ok, fail } from '@/lib/api/v1/respond'

/**
 * Context for the custom-field / table helpers from an API key. API keys
 * have no user role: access is decided by the scope the route required, so
 * the helpers run as an admin of the key's account (never beyond it).
 */
export function fieldCtx(ctx: ApiKeyContext): Ctx {
  return { db: ctx.supabase, accountId: ctx.accountId, userId: ctx.createdBy, role: 'admin' }
}

export function segCtx(ctx: ApiKeyContext): SegCtx {
  return { db: ctx.supabase, accountId: ctx.accountId, userId: ctx.createdBy }
}

type R<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

const CODES: Record<number, string> = {
  400: 'bad_request',
  402: 'plan_limit',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
}

/** Result of a helper -> v1 envelope. */
export function envelope<T>(result: R<T>, okStatus = 200) {
  if (!result.ok) return fail(CODES[result.status] ?? 'internal', result.error, result.status)
  return ok(result.data, okStatus)
}

export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}
