import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from '@/test-utils/fake-db'

let db: FakeDb
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => ({ supabase: db, userId: 'u1', accountId: 'a1', role: 'agent', account: { id: 'a1' } }),
  toErrorResponse: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}))
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => db }))

const { GET, PATCH } = await import('./route')

beforeEach(() => {
  db = new FakeDb(
    {
      rpc: {
        partner_leaderboard: (_a, d) =>
          d
            .rows('partners')
            .filter((p) => p.show_on_leaderboard)
            .map((p) => ({ user_id: p.user_id, display_name: p.display_name ?? p.code, referrals: d.rows('referrals').filter((r) => r.partner_user_id === p.user_id).length })),
      },
    },
    {
      profiles: [
        { user_id: 'u1', full_name: 'Ada Obi', email: 'ada@x.com' },
        { user_id: 'r1', full_name: 'Bob', email: 'bobby@gmail.com' },
      ],
      partners: [
        { user_id: 'u1', code: 'ADA1', display_name: 'Ada', show_on_leaderboard: false, payout_details: { bank_name: 'GT' }, status: 'active' },
        { user_id: 'p9', code: 'TOP99', display_name: 'Top', show_on_leaderboard: true, payout_details: { bank_name: 'SECRET' }, status: 'active' },
      ],
      referrals: [{ id: 'x1', partner_user_id: 'u1', referred_user_id: 'r1', referred_account_id: 'ra', created_at: '2026-11-02T00:00:00Z' }],
      account_subscriptions: [{ account_id: 'ra', plan_id: 'pro', status: 'active' }],
      partner_settings: [{ id: 1, enabled: true, commission_percent: 20, recurring_months: 12, min_payout: 50, currency: 'USD' }],
      partner_materials: [{ id: 'm1', title: 'Banner', kind: 'image', url: 'https://x/y.png', is_active: true, sort_order: 1 }],
    },
  )
})

describe('GET /api/partner/me', () => {
  it('returns the link, masked referrals with plan, report and materials for any role', async () => {
    const body = await (await GET()).json()
    expect(body.code).toBe('ADA1')
    expect(body.link).toContain('/signup?ref=ADA1')
    expect(body.stats).toEqual({ clicks: 0, signups: 1, customers: 1, byPlan: { pro: 1 } })
    expect(body.referrals).toEqual([{ id: 'x1', who: 'bo***@gmail.com', plan: 'pro', at: '2026-11-02T00:00:00Z' }])
    expect(body.report).toEqual([{ month: '2026-11', count: 1 }])
    expect(body.materials).toHaveLength(1)
    expect(body.settings.commissionPercent).toBe(20)
  })
  it('lists only opted-in partners on the leaderboard, never their payout details', async () => {
    const body = await (await GET()).json()
    expect(body.leaderboard).toEqual([{ rank: 1, name: 'Top', referrals: 0, isYou: false }])
    expect(JSON.stringify(body)).not.toContain('SECRET')
  })
  it('creates the partner row on first visit', async () => {
    db.rows('partners').splice(0, 1)
    const body = await (await GET()).json()
    expect(body.code).toMatch(/^ADAOBI[0-9A-F]{4}$/)
  })
})

describe('PATCH /api/partner/me', () => {
  const patch = (b: unknown) => PATCH(new Request('https://x.test', { method: 'PATCH', body: JSON.stringify(b) }))
  it('saves leaderboard opt-in and payout details for the caller only', async () => {
    const res = await patch({ show_on_leaderboard: true, payout_details: { bank_name: 'GTBank', account_name: 'Ada Obi', account_number: '0123456789' } })
    expect(res.status).toBe(200)
    const mine = db.rows('partners').find((p) => p.user_id === 'u1')!
    expect(mine.show_on_leaderboard).toBe(true)
    expect(mine.payout_details).toMatchObject({ account_number: '0123456789' })
    expect(db.rows('partners').find((p) => p.user_id === 'p9')!.payout_details).toEqual({ bank_name: 'SECRET' })
  })
  it('rejects invalid input', async () => {
    expect((await patch({ payout_details: { bank_name: 'x', account_name: 'y', account_number: '1' } })).status).toBe(400)
  })
})
