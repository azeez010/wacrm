import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from '@/test-utils/fake-db'

const crmTrack = vi.fn()
const crmSyncUser = vi.fn()
vi.mock('@/lib/crm', () => ({ crmTrack: (...a: unknown[]) => crmTrack(...a), crmSyncUser: (...a: unknown[]) => crmSyncUser(...a) }))

const { attributeReferral } = await import('./attribute')
const { ensurePartner, generateCode, normalizeCode } = await import('./code')
const { parsePartnerPatch, maskEmail } = await import('./input')

let db: FakeDb
beforeEach(() => {
  crmTrack.mockReset().mockResolvedValue(undefined)
  crmSyncUser.mockReset().mockResolvedValue(undefined)
  db = new FakeDb(
    { isDuplicate: (table, row, existing) => table === 'referrals' && existing.some((r) => r.referred_user_id === row.referred_user_id) || (table === 'partners' && existing.some((r) => r.code === row.code || r.user_id === row.user_id)) },
    {
      partners: [
        { user_id: 'p1', code: 'AMAKA1234', status: 'active' },
        { user_id: 'p2', code: 'BANNED', status: 'suspended' },
      ],
      referrals: [],
    },
  )
})

describe('codes', () => {
  it('normalizes and validates', () => {
    expect(normalizeCode(' amaka1234 ')).toBe('AMAKA1234')
    expect(normalizeCode('a')).toBeNull()
    expect(normalizeCode('bad code!')).toBeNull()
    expect(normalizeCode(42)).toBeNull()
  })
  it('generates a valid code from a name, with a fallback', () => {
    expect(normalizeCode(generateCode('Ada Lovelace-Byron'))).toMatch(/^ADALOVELAC[0-9A-F]{4}$/)
    expect(normalizeCode(generateCode(null))).toMatch(/^OGA[0-9A-F]{4}$/)
  })
  it('ensurePartner creates once and returns the same row after', async () => {
    const a = await ensurePartner(db.asClient(), 'u9', 'Zed')
    const b = await ensurePartner(db.asClient(), 'u9', 'Zed')
    expect(a.code).toBe(b.code)
    expect(db.rows('partners').filter((p) => p.user_id === 'u9')).toHaveLength(1)
  })
})

describe('attributeReferral', () => {
  const go = (userId: string, code: unknown) => attributeReferral(db.asClient(), { userId, accountId: 'a1', code })

  it('links a new user to the partner (case-insensitive) and tells the CRM', async () => {
    expect(await go('u1', 'amaka1234')).toBe('attributed')
    expect(db.rows('referrals')).toMatchObject([{ partner_user_id: 'p1', referred_user_id: 'u1', referred_account_id: 'a1', code: 'AMAKA1234' }])
    expect(crmTrack).toHaveBeenCalledWith('referral_signed_up', expect.objectContaining({ userId: 'p1' }))
    expect(crmSyncUser).toHaveBeenCalledWith('u1')
  })
  it('ignores self-referral, unknown, suspended and malformed codes', async () => {
    expect(await go('p1', 'AMAKA1234')).toBe('self')
    expect(await go('u1', 'NOPE123')).toBe('unknown_code')
    expect(await go('u1', 'BANNED')).toBe('suspended')
    expect(await go('u1', '!!')).toBe('invalid_code')
    expect(db.rows('referrals')).toHaveLength(0)
    expect(crmTrack).not.toHaveBeenCalled()
  })
  it('keeps the first referrer', async () => {
    db.rows('partners').push({ user_id: 'p3', code: 'SECOND', status: 'active' })
    expect(await go('u1', 'AMAKA1234')).toBe('attributed')
    expect(await go('u1', 'SECOND')).toBe('already')
    expect(db.rows('referrals')).toHaveLength(1)
  })
})

describe('parsePartnerPatch', () => {
  it('accepts a clean payout detail and trims', () => {
    const r = parsePartnerPatch({ payout_details: { bank_name: ' GTBank ', account_name: 'Ada', account_number: '0123 456 789' } })
    expect(r).toEqual({ ok: true, value: { payout_details: { bank_name: 'GTBank', account_name: 'Ada', account_number: '0123456789' } } })
  })
  it('rejects bad payout details, bad types and empty patches', () => {
    expect(parsePartnerPatch({ payout_details: { bank_name: 'X', account_name: 'Y', account_number: '12' } }).ok).toBe(false)
    expect(parsePartnerPatch({ payout_details: { bank_name: '', account_name: 'Y', account_number: '0123456789' } }).ok).toBe(false)
    expect(parsePartnerPatch({ show_on_leaderboard: 'yes' }).ok).toBe(false)
    expect(parsePartnerPatch({}).ok).toBe(false)
    expect(parsePartnerPatch(null).ok).toBe(false)
  })
  it('lets a partner clear payout details and name', () => {
    expect(parsePartnerPatch({ payout_details: { bank_name: '', account_name: '', account_number: '' }, display_name: '  ' }).ok).toBe(true)
  })
  it('masks emails', () => {
    expect(maskEmail('jane.doe@gmail.com')).toBe('ja***@gmail.com')
    expect(maskEmail(null)).toBe('—')
  })
})
