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
const { PUT } = await import('./route')
const put = (b: unknown) => PUT(new Request('https://x.test', { method: 'PUT', body: JSON.stringify(b) }))

beforeEach(() => {
  crmSyncUser.mockReset().mockResolvedValue(undefined)
  db = new FakeDb({}, { profiles: [{ user_id: 'u1', phone: '+2348000000001' }, { user_id: 'u2', phone: '+2348000000002' }] })
})

describe('/api/account/phone', () => {
  it('saves a valid number for the caller only, normalised with +, and syncs the CRM', async () => {
    const res = await put({ phone: '+234 812 742 3455' })
    expect(await res.json()).toEqual({ phone: '+2348127423455' })
    expect(db.rows('profiles')[0].phone).toBe('+2348127423455')
    expect(db.rows('profiles')[1].phone).toBe('+2348000000002')
    expect(crmSyncUser).toHaveBeenCalledWith('u1')
  })
  it('clears the number with null or empty', async () => {
    await put({ phone: null })
    expect(db.rows('profiles')[0].phone).toBeNull()
    await put({ phone: '' })
    expect(db.rows('profiles')[0].phone).toBeNull()
  })
  it('rejects numbers without + and country code, and a missing field', async () => {
    expect((await put({ phone: '08127423455' })).status).toBe(400)
    expect((await put({ phone: 5 })).status).toBe(400)
    expect((await put({})).status).toBe(400)
    expect(crmSyncUser).not.toHaveBeenCalled()
  })
})
