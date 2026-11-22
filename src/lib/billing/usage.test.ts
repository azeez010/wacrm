import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { toApiErrorResponse } from '@/lib/api/v1/respond'
import { FeatureLockedError, PlanLimitError } from './entitlements'
import {
  QuotaExceededError,
  assertMessageQuota,
  countBillableMessages,
  monthStartUtc,
  nextMonthStartUtc,
} from './usage'

/** Fake client: a plan with `limit` messages and `used` already sent. */
function fakeDb(limit: number | null | undefined, used: number, rpcError = false): SupabaseClient {
  return {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () =>
          table === 'account_subscriptions'
            ? { data: { plan_id: 'free', status: 'active', limit_overrides: null, feature_overrides: null } }
            : { data: { name: 'Free', limits: limit === undefined ? {} : { messages_per_month: limit }, features: {} } },
      }
      return chain
    },
    rpc: vi.fn(async () => (rpcError ? { data: null, error: { message: 'boom' } } : { data: used, error: null })),
  } as unknown as SupabaseClient
}

describe('billing period', () => {
  it('is the calendar month in UTC', () => {
    const now = new Date('2026-11-20T15:30:00Z')
    expect(monthStartUtc(now).toISOString()).toBe('2026-11-01T00:00:00.000Z')
    expect(nextMonthStartUtc(now).toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(nextMonthStartUtc(new Date('2026-12-31T23:59:59Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })
})

describe('assertMessageQuota', () => {
  it('allows sends within the allowance, up to exactly the limit', async () => {
    await expect(assertMessageQuota(fakeDb(1000, 998), 'a', 2)).resolves.toBeUndefined()
  })

  it('refuses one message past the limit with a QuotaExceededError', async () => {
    const err = await assertMessageQuota(fakeDb(1000, 1000), 'a', 1).catch((e) => e)
    expect(err).toBeInstanceOf(QuotaExceededError)
    expect(err.message).toContain('Free plan includes 1,000 messages per month')
  })

  it('refuses a broadcast that would not fit in what is left', async () => {
    await expect(assertMessageQuota(fakeDb(1000, 900), 'a', 150)).rejects.toBeInstanceOf(QuotaExceededError)
  })

  it('treats a missing or null limit as unlimited (and does not even count)', async () => {
    const db = fakeDb(null, 999999)
    await expect(assertMessageQuota(db, 'a', 5)).resolves.toBeUndefined()
    expect(db.rpc).not.toHaveBeenCalled()
    await expect(assertMessageQuota(fakeDb(undefined, 5), 'a', 5)).resolves.toBeUndefined()
  })

  it('fails open if counting breaks (an OTP must not be blocked by a counting hiccup)', async () => {
    expect(await countBillableMessages(fakeDb(10, 0, true), 'a')).toBe(0)
    await expect(assertMessageQuota(fakeDb(10, 0, true), 'a', 1)).resolves.toBeUndefined()
  })
})

describe('plan errors on the public API', () => {
  it('maps count/feature limits to 402 plan_limit and the allowance to 402 quota_exceeded', async () => {
    const limit = toApiErrorResponse(new PlanLimitError('api_keys', 1, 'Free'))
    expect(limit.status).toBe(402)
    expect((await limit.json()).error.code).toBe('plan_limit')

    const feature = toApiErrorResponse(new FeatureLockedError('public_api', 'Free'))
    expect(feature.status).toBe(402)
    expect((await feature.json()).error.code).toBe('plan_limit')

    const quota = toApiErrorResponse(new QuotaExceededError(1000, 1000, 'Free'))
    expect(quota.status).toBe(402)
    expect((await quota.json()).error.code).toBe('quota_exceeded')
  })
})
