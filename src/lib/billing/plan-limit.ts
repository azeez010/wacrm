// One way to recognise "you hit a plan limit" wherever it comes from, so every screen can open the same
// upgrade dialog instead of toasting a sentence.
//   * our internal JSON (402): { code: 'plan_limit', limit_key, limit, plan? }
//   * the older integrations shape: { upgrade: true }
//   * the database text from limit triggers / functions: 'plan_limit:<key>:<n>' (e.g. contacts, workspaces)
import type { LimitKey } from './plans'

export interface PlanLimitHit {
  limitKey: LimitKey | null
  limit: number | null
}

export const PLAN_LIMIT_EVENT = 'ogadesk:plan-limit'

const DB_TEXT = /plan_limit:([a-z_]+):(\d+)/

/** The limit behind an error body, a thrown error or its message, or null when it is not a plan limit. */
export function parsePlanLimit(x: unknown): PlanLimitHit | null {
  if (x == null) return null
  if (typeof x === 'string') {
    const m = DB_TEXT.exec(x)
    return m ? { limitKey: m[1] as LimitKey, limit: Number(m[2]) } : null
  }
  if (x instanceof Error) return parsePlanLimit(x.message)
  if (typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  if (o.code === 'plan_limit') {
    const fromText = typeof o.error === 'string' ? parsePlanLimit(o.error) : null
    return {
      limitKey: typeof o.limit_key === 'string' ? (o.limit_key as LimitKey) : fromText?.limitKey ?? null,
      limit: typeof o.limit === 'number' ? o.limit : fromText?.limit ?? null,
    }
  }
  if (o.upgrade === true) return { limitKey: null, limit: null }
  for (const k of ['message', 'error', 'details']) {
    if (typeof o[k] === 'string') {
      const hit = parsePlanLimit(o[k])
      if (hit) return hit
    }
  }
  return null
}

/** Opens the upgrade dialog (mounted once in the dashboard shell) for this limit. */
export function notifyPlanLimit(hit: PlanLimitHit) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<PlanLimitHit>(PLAN_LIMIT_EVENT, { detail: hit }))
}

/** parse + notify in one go. Returns true when it was a plan limit (so the caller skips its own error toast). */
export function handlePlanLimit(x: unknown): boolean {
  const hit = parsePlanLimit(x)
  if (!hit) return false
  notifyPlanLimit(hit)
  return true
}

/** A usage meter near or at its plan limit: 'near' from 80%, 'at' when full. null for unlimited or plenty of room. */
export function nudgeState(used: number, limit: number | null): 'near' | 'at' | null {
  if (limit === null) return null
  if (used >= limit) return 'at'
  if (limit > 0 && used / limit >= 0.8) return 'near'
  return null
}
