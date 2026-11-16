import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  FeatureLockedError,
  PlanLimitError,
  assertFeature,
  assertWithinLimit,
  getLimit,
} from './entitlements'

function db(opts: {
  sub?: Record<string, unknown> | null
  plans?: Record<string, { name: string; limits: object; features: object }>
}): SupabaseClient {
  const plans = opts.plans ?? {
    free: { name: 'Free', limits: { contacts: 10, seats: null }, features: { flows: true } },
    pro: { name: 'Pro', limits: { contacts: 1000 }, features: { flows: true, public_api: true } },
  }
  return {
    from(table: string) {
      let planId: string | undefined
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (col: string, v: string) => {
          if (table === 'plans' && col === 'id') planId = v
          return b
        },
        maybeSingle: async () =>
          table === 'account_subscriptions'
            ? { data: opts.sub ?? null, error: null }
            : { data: planId ? (plans[planId] ?? null) : null, error: null },
      }
      return b
    },
  } as unknown as SupabaseClient
}

describe('entitlements', () => {
  it('uses the plan limit for an active subscription', async () => {
    const r = await getLimit(db({ sub: { plan_id: 'pro', status: 'active' } }), 'a', 'contacts')
    expect(r).toEqual({ planName: 'Pro', limit: 1000 })
  })

  it('falls back to free when there is no subscription row', async () => {
    const r = await getLimit(db({ sub: null }), 'a', 'contacts')
    expect(r).toEqual({ planName: 'Free', limit: 10 })
  })

  it('falls back to free when the subscription is canceled or past due', async () => {
    for (const status of ['canceled', 'past_due']) {
      const r = await getLimit(db({ sub: { plan_id: 'pro', status } }), 'a', 'contacts')
      expect(r.limit).toBe(10)
    }
  })

  it('treats null and missing limits as unlimited', async () => {
    const d = db({ sub: { plan_id: 'free', status: 'active' } })
    expect((await getLimit(d, 'a', 'seats')).limit).toBeNull()
    expect((await getLimit(d, 'a', 'storage_mb')).limit).toBeNull()
  })

  it('lets a per-account override beat the plan, including null = unlimited', async () => {
    const sub = (o: object) => ({ plan_id: 'free', status: 'active', limit_overrides: o })
    expect((await getLimit(db({ sub: sub({ contacts: 99 }) }), 'a', 'contacts')).limit).toBe(99)
    expect((await getLimit(db({ sub: sub({ contacts: null }) }), 'a', 'contacts')).limit).toBeNull()
  })

  it('blocks at the limit and allows below it', async () => {
    const d = db({ sub: { plan_id: 'free', status: 'active' } })
    await expect(assertWithinLimit(d, 'a', 'contacts', 9)).resolves.toBeUndefined()
    await expect(assertWithinLimit(d, 'a', 'contacts', 10)).rejects.toBeInstanceOf(PlanLimitError)
  })

  it('gates features, with overrides', async () => {
    const free = db({ sub: { plan_id: 'free', status: 'active' } })
    await expect(assertFeature(free, 'a', 'flows')).resolves.toBeUndefined()
    await expect(assertFeature(free, 'a', 'public_api')).rejects.toBeInstanceOf(FeatureLockedError)
    const granted = db({
      sub: { plan_id: 'free', status: 'active', feature_overrides: { public_api: true } },
    })
    await expect(assertFeature(granted, 'a', 'public_api')).resolves.toBeUndefined()
  })
})
