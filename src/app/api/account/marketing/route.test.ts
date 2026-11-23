import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from '@/test-utils/fake-db'

let db: FakeDb
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => ({ supabase: db, userId: 'u1', accountId: 'a1', role: 'agent' }),
  toErrorResponse: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}))
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => db }))
const crmSyncUser = vi.fn()
vi.mock('@/lib/crm', () => ({ crmSyncUser: (...a: unknown[]) => crmSyncUser(...a) }))
const { GET, PUT } = await import('./route')
const put = (b: unknown) => PUT(new Request('https://x.test', { method: 'PUT', body: JSON.stringify(b) }))

beforeEach(() => {
  crmSyncUser.mockReset().mockResolvedValue(undefined)
  db = new FakeDb({}, { profiles: [{ user_id: 'u1', marketing_opt_in: true }, { user_id: 'u2', marketing_opt_in: true }] })
})

describe('/api/account/marketing', () => {
  it('reads the caller\'s choice', async () => {
    expect(await (await GET()).json()).toEqual({ opt_in: true })
  })
  it('turns it off for the caller only, stamps the time, and syncs the CRM', async () => {
    expect((await put({ opt_in: false })).status).toBe(200)
    expect(db.rows('profiles')[0]).toMatchObject({ marketing_opt_in: false, marketing_opt_in_at: null })
    expect(db.rows('profiles')[1].marketing_opt_in).toBe(true)
    expect(crmSyncUser).toHaveBeenCalledWith('u1')
    await put({ opt_in: true })
    expect(db.rows('profiles')[0].marketing_opt_in_at).toEqual(expect.any(String))
  })
  it('rejects anything but a boolean', async () => {
    expect((await put({ opt_in: 'yes' })).status).toBe(400)
    expect((await put({})).status).toBe(400)
  })
})
