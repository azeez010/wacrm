import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from '@/test-utils/fake-db'

let role = 'owner'
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => ({
    supabase: admin,
    userId: 'u1',
    accountId: 'a1',
    role,
    account: { id: 'a1', name: 'Acme' },
  }),
  toErrorResponse: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}))
let admin: FakeDb
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => admin }))
const crmTrack = vi.fn()
const crmSyncUser = vi.fn()
vi.mock('@/lib/crm', () => ({ crmTrack: (...a: unknown[]) => crmTrack(...a), crmSyncUser: (...a: unknown[]) => crmSyncUser(...a) }))
let cookieJar: Record<string, string> = {}
let headerJar: Record<string, string> = {}
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n in cookieJar ? { name: n, value: cookieJar[n] } : undefined) }),
  headers: async () => ({ get: (n: string) => headerJar[n.toLowerCase()] ?? null }),
}))

const { GET, POST, PATCH } = await import('./route')

const post = (body: unknown) =>
  POST(new Request('https://x.test/api/onboarding', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  role = 'owner'
  cookieJar = {}
  headerJar = {}
  crmTrack.mockReset().mockResolvedValue(undefined)
  crmSyncUser.mockReset().mockResolvedValue(undefined)
  admin = new FakeDb({}, {
    accounts: [{ id: 'a1', use_cases: [], heard_from: null, referral_code: null, onboarded_at: null }],
    profiles: [{ user_id: 'u1', account_id: 'a1' }],
  })
})

describe('GET /api/onboarding', () => {
  it('asks only the owner, and only until they have answered', async () => {
    expect(await (await GET()).json()).toMatchObject({ needsOnboarding: true })
    role = 'agent'
    expect(await (await GET()).json()).toMatchObject({ needsOnboarding: false })
    role = 'owner'
    admin.rows('accounts')[0].onboarded_at = '2026-11-01T00:00:00Z'
    expect(await (await GET()).json()).toMatchObject({ needsOnboarding: false })
  })
})

describe('POST /api/onboarding', () => {
  it('saves the answers, profile facts and queues the CRM event (first time)', async () => {
    cookieJar = { NEXT_LOCALE: 'fr' }
    headerJar = { 'cf-ipcountry': 'ng' }
    const res = await post({ use_cases: ['developer', 'sales'], heard_from: 'google', heard_from_detail: 'newsletter', marketing_opt_in: true })
    expect(res.status).toBe(200)
    expect(admin.rows('accounts')[0]).toMatchObject({ use_cases: ['developer', 'sales'], heard_from: 'google', heard_from_detail: 'newsletter' })
    expect(admin.rows('accounts')[0].onboarded_at).toBeTruthy()
    expect(admin.rows('profiles')[0]).toMatchObject({ locale: 'fr', country: 'NG', marketing_opt_in: true })
    expect(admin.rows('profiles')[0].marketing_opt_in_at).toBeTruthy()
    expect(crmTrack).toHaveBeenCalledWith('onboarding_completed', expect.objectContaining({ userId: 'u1', accountId: 'a1' }))
  })

  it('stores the referral code from the cookie and defaults the source to partner', async () => {
    cookieJar = { ogadesk_ref: 'AMAKA' }
    await post({ use_cases: ['support'] })
    expect(admin.rows('accounts')[0]).toMatchObject({ referral_code: 'AMAKA', heard_from: 'partner' })
  })

  it('keeps the first referral code and the original onboarding time on a re-post, without re-announcing', async () => {
    admin.rows('accounts')[0].referral_code = 'FIRST'
    admin.rows('accounts')[0].onboarded_at = '2026-11-01T00:00:00Z'
    cookieJar = { ogadesk_ref: 'SECOND' }
    await post({ use_cases: ['marketing'], heard_from: 'blog' })
    expect(admin.rows('accounts')[0]).toMatchObject({ referral_code: 'FIRST', onboarded_at: '2026-11-01T00:00:00Z', use_cases: ['marketing'] })
    expect(crmTrack).not.toHaveBeenCalled()
    expect(crmSyncUser).toHaveBeenCalledWith('u1')
  })

  it('ignores an invalid cookie, an unknown country and a skipped opt-in', async () => {
    cookieJar = { ogadesk_ref: '<bad>' }
    headerJar = { 'cf-ipcountry': 'XX' }
    await post({ use_cases: ['support'] })
    expect(admin.rows('accounts')[0].referral_code).toBeNull()
    expect(admin.rows('profiles')[0]).toMatchObject({ country: null, marketing_opt_in: false, marketing_opt_in_at: null })
  })

  it('refuses non-owners and bad input', async () => {
    role = 'admin'
    expect((await post({ use_cases: ['support'] })).status).toBe(403)
    role = 'owner'
    expect((await post({ use_cases: [] })).status).toBe(400)
    expect(admin.rows('accounts')[0].onboarded_at).toBeNull()
  })
})

describe('PATCH /api/onboarding (edit how you use OgaDesk)', () => {
  const patch = (body: unknown) => PATCH(new Request('https://x.test/api/onboarding', { method: 'PATCH', body: JSON.stringify(body) }))

  it('the owner can change the use cases; onboarding state is untouched and the CRM is re-synced', async () => {
    admin.rows('accounts')[0].onboarded_at = '2026-11-01T00:00:00Z'
    const res = await patch({ use_cases: ['support', 'support', 'marketing'] })
    expect(res.status).toBe(200)
    expect(admin.rows('accounts')[0].use_cases).toEqual(['support', 'marketing'])
    expect(admin.rows('accounts')[0].onboarded_at).toBe('2026-11-01T00:00:00Z')
    expect(crmSyncUser).toHaveBeenCalledWith('u1')
  })
  it('rejects empty or unknown choices and non-owners', async () => {
    expect((await patch({ use_cases: [] })).status).toBe(400)
    expect((await patch({ use_cases: ['nope'] })).status).toBe(400)
    role = 'admin'
    expect((await patch({ use_cases: ['sales'] })).status).toBe(403)
    expect(admin.rows('accounts')[0].use_cases).toEqual([])
  })
})
