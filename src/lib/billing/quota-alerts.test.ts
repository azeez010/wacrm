import { beforeEach, describe, expect, it, vi } from 'vitest'

let used = 0
let limit: number | null = 1000
vi.mock('./usage', () => ({ countBillableMessages: async () => used }))
vi.mock('./entitlements', () => ({ getLimit: async () => ({ planName: 'Free', limit }) }))
let crmOn = true
let mailOn = true
const seen = new Set<string>()
const crmTrack = vi.fn(async (_name: string, t: { onceKey?: string }) => {
  if (t.onceKey && seen.has(t.onceKey)) return false
  if (t.onceKey) seen.add(t.onceKey)
  return true
})
vi.mock('@/lib/crm', () => ({
  crmTrack: (...a: [string, { onceKey?: string }]) => crmTrack(...a),
  isCrmEnabled: () => crmOn,
  isEmailEnabled: () => mailOn,
}))
const queueQuotaEmail = vi.fn()
vi.mock('@/lib/email/queue', () => ({ queueQuotaEmail: (...a: unknown[]) => queueQuotaEmail(...a) }))
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({}) }))

const { checkQuotaThresholds } = await import('./quota-alerts')
const NOW = new Date('2026-11-20T10:00:00Z')
const db = {} as never

beforeEach(() => {
  used = 0
  limit = 1000
  crmOn = true
  mailOn = true
  seen.clear()
  crmTrack.mockClear()
  const emailed = new Set<string>()
  queueQuotaEmail.mockReset().mockImplementation(async (_db, acct: string, level: number, month: string) => {
    const k = `${acct}:${level}:${month}`
    if (emailed.has(k)) return false
    emailed.add(k)
    return true
  })
})

describe('checkQuotaThresholds', () => {
  it('does nothing below 80%, on unlimited plans, or when nothing is configured', async () => {
    used = 799
    expect(await checkQuotaThresholds(db, 'a1', NOW)).toBeNull()
    used = 5000
    limit = null
    expect(await checkQuotaThresholds(db, 'a1', NOW)).toBeNull()
    limit = 1000
    crmOn = false
    mailOn = false
    expect(await checkQuotaThresholds(db, 'a1', NOW)).toBeNull()
    expect(crmTrack).not.toHaveBeenCalled()
    expect(queueQuotaEmail).not.toHaveBeenCalled()
  })

  it('announces 80% once per month (event + email), then 100% once per month', async () => {
    used = 800
    expect(await checkQuotaThresholds(db, 'a1', NOW)).toBe('quota_80')
    expect(await checkQuotaThresholds(db, 'a1', NOW)).toBeNull()
    expect(crmTrack).toHaveBeenCalledWith('quota_80', {
      accountId: 'a1',
      properties: { used: 800, limit: 1000, percent: 80 },
      onceKey: 'once:quota_80:a1:2026-11',
    })
    expect(queueQuotaEmail).toHaveBeenCalledWith(db, 'a1', 80, '2026-11', 800, 1000)

    used = 1000
    expect(await checkQuotaThresholds(db, 'a1', NOW)).toBe('quota_100')
    expect(await checkQuotaThresholds(db, 'a1', NOW)).toBeNull()
  })

  it('jumping straight past 80% announces only 100%, and a new month starts fresh', async () => {
    used = 1200
    expect(await checkQuotaThresholds(db, 'a1', NOW)).toBe('quota_100')
    expect(crmTrack).toHaveBeenCalledTimes(1)
    expect(await checkQuotaThresholds(db, 'a1', new Date('2026-12-02T00:00:00Z'))).toBe('quota_100')
  })

  it('still emails when only the email provider is configured', async () => {
    crmOn = false
    crmTrack.mockResolvedValue(false)
    used = 900
    expect(await checkQuotaThresholds(db, 'a1', NOW)).toBe('quota_80')
  })
})
