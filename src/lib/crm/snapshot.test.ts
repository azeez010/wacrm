import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from '@/test-utils/fake-db'
import { CRM_LISTS } from './attributes'

vi.mock('@/lib/billing/usage', () => ({ countBillableMessages: vi.fn(async () => 250) }))
vi.mock('@/lib/billing/entitlements', () => ({
  getEntitlements: vi.fn(async () => ({ planName: 'Free', limits: { messages_per_month: 1000 }, features: {} })),
}))

const { buildContactSnapshot } = await import('./snapshot')

function seed(over: { profile?: Record<string, unknown>; account?: Record<string, unknown> } = {}) {
  return new FakeDb({}, {
    profiles: [
      { user_id: 'u1', full_name: 'Jane Q Doe', email: 'Jane@Example.com', account_id: 'a1', account_role: 'owner', locale: 'fr', country: 'NG', marketing_opt_in: true, created_at: '2026-11-01T08:00:00Z', ...over.profile },
      { user_id: 'u2', account_id: 'a1', email: 'bob@example.com' },
    ],
    accounts: [
      { id: 'a1', timezone: 'Africa/Lagos', use_cases: ['developer', 'sales'], heard_from: 'google', heard_from_detail: null, referral_code: 'AMAKA', onboarded_at: '2026-11-02T09:00:00Z', ...over.account },
    ],
    account_subscriptions: [{ account_id: 'a1', plan_id: 'starter', status: 'active', billing_interval: 'monthly', current_period_end: '2026-12-02T00:00:00Z' }],
    whatsapp_config: [{ id: 'w1', account_id: 'a1', status: 'connected' }, { id: 'w2', account_id: 'a1', status: 'disconnected' }],
    api_keys: [{ id: 'k1', account_id: 'a1', revoked_at: null }, { id: 'k2', account_id: 'a1', revoked_at: '2026-11-03T00:00:00Z' }],
    webhook_endpoints: [{ id: 'h1', account_id: 'a1' }],
    subscription_payments: [
      { account_id: 'a1', status: 'succeeded', amount: 15000 },
      { account_id: 'a1', status: 'failed', amount: 15000 },
      { account_id: 'a1', status: 'succeeded', amount: '15000.50' },
    ],
  })
}

beforeEach(() => vi.clearAllMocks())

describe('buildContactSnapshot', () => {
  it('describes the user, their plan and their usage', async () => {
    const c = await buildContactSnapshot(seed().asClient(), 'u1')
    expect(c).toMatchObject({ externalId: 'u1', email: 'jane@example.com' })
    expect(c!.attributes).toEqual({
      FIRSTNAME: 'Jane',
      LASTNAME: 'Q Doe',
      OGA_USER_ID: 'u1',
      ROLE: 'owner',
      LANGUAGE: 'fr',
      COUNTRY: 'NG',
      SIGNED_UP_AT: '2026-11-01',
      MARKETING_OPT_IN: true,
      OGA_ACCOUNT_ID: 'a1',
      TIMEZONE: 'Africa/Lagos',
      USE_CASES: 'developer,sales',
      HEARD_FROM: 'google',
      HEARD_FROM_DETAIL: null,
      REFERRAL_CODE: 'AMAKA',
      ONBOARDED_AT: '2026-11-02',
      PLAN: 'starter',
      PLAN_STATUS: 'active',
      BILLING_INTERVAL: 'monthly',
      PLAN_RENEWS_AT: '2026-12-02',
      LIFETIME_PAID: 30000.5,
      WHATSAPP_CONNECTED: true,
      WHATSAPP_NUMBERS: 2,
      API_KEYS: 1,
      WEBHOOK_ENDPOINTS: 1,
      MEMBERS: 2,
      MESSAGES_THIS_MONTH: 250,
      MESSAGE_LIMIT: 1000,
      QUOTA_PERCENT: 25,
    })
  })

  it('puts people on lists by use case and marketing consent', async () => {
    const opted = await buildContactSnapshot(seed().asClient(), 'u1')
    expect(opted!.lists.sort()).toEqual([CRM_LISTS.all, CRM_LISTS.marketing, CRM_LISTS.developer, CRM_LISTS.sales].sort())
    const notOpted = await buildContactSnapshot(seed({ profile: { marketing_opt_in: false } }).asClient(), 'u1')
    expect(notOpted!.lists).not.toContain(CRM_LISTS.marketing)
    expect(notOpted!.attributes.MARKETING_OPT_IN).toBe(false)
  })

  it('handles unlimited plans and an account that has not onboarded', async () => {
    const { getEntitlements } = await import('@/lib/billing/entitlements')
    vi.mocked(getEntitlements).mockResolvedValueOnce({ planName: 'Pro', limits: {}, features: {} })
    const c = await buildContactSnapshot(seed({ account: { use_cases: [], onboarded_at: null, heard_from: null } }).asClient(), 'u1')
    expect(c!.attributes).toMatchObject({ MESSAGE_LIMIT: null, QUOTA_PERCENT: 0, USE_CASES: '', ONBOARDED_AT: null })
    expect(c!.lists).toEqual([CRM_LISTS.all, CRM_LISTS.marketing])
  })

  it('returns null for an unknown user or one without an email, and a minimal record without an account', async () => {
    expect(await buildContactSnapshot(seed().asClient(), 'nobody')).toBeNull()
    expect(await buildContactSnapshot(seed({ profile: { email: null } }).asClient(), 'u1')).toBeNull()
    const lone = await buildContactSnapshot(seed({ profile: { account_id: null } }).asClient(), 'u1')
    expect(lone!.attributes.PLAN).toBeUndefined()
    expect(lone!.attributes.OGA_USER_ID).toBe('u1')
  })
})
