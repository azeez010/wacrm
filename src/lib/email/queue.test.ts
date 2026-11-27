import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from '@/test-utils/fake-db'

let mailOn = true
vi.mock('@/lib/crm/registry', () => ({ isEmailEnabled: () => mailOn, isCrmEnabled: () => true }))
const scheduleFlush = vi.fn()
vi.mock('@/lib/crm', () => ({ scheduleFlush: () => scheduleFlush() }))
vi.mock('@/lib/billing/entitlements', () => ({ getEntitlements: async () => ({ planName: 'Free', limits: {}, features: {} }) }))

const { queueWelcomeEmail, queueQuotaEmail } = await import('./queue')

function seed() {
  return new FakeDb({}, {
    crm_outbox: [],
    profiles: [{ user_id: 'u1', full_name: 'Jane Doe', email: 'Jane@Example.com', locale: 'fr' }],
    accounts: [{ id: 'a1', owner_user_id: 'u1', use_cases: ['developer'] }],
  })
}

beforeEach(() => {
  mailOn = true
  process.env.EMAIL_FROM_ADDRESS = 'hello@ogadesk.com'
  process.env.EMAIL_FROM_NAME = 'OgaDesk'
  scheduleFlush.mockReset()
})

describe('queueWelcomeEmail', () => {
  it('queues one rendered email in the person\'s language and drains soon', async () => {
    const db = seed()
    expect(await queueWelcomeEmail(db.asClient(), 'u1', 'a1')).toBe(true)
    const row = db.rows('crm_outbox')[0]
    expect(row).toMatchObject({ kind: 'email', user_id: 'u1', account_id: 'a1', dedupe_key: 'once:welcome:u1' })
    expect(row.payload).toMatchObject({
      to: { email: 'jane@example.com', name: 'Jane' },
      from: { email: 'hello@ogadesk.com', name: 'OgaDesk' },
      subject: 'Bienvenue sur OgaDesk',
      tags: ['welcome'],
    })
    expect(scheduleFlush).toHaveBeenCalled()
  })

  it('sends the welcome only once per person', async () => {
    const db = seed()
    await queueWelcomeEmail(db.asClient(), 'u1', 'a1')
    expect(await queueWelcomeEmail(db.asClient(), 'u1', 'a1')).toBe(false)
    expect(db.rows('crm_outbox')).toHaveLength(1)
  })

  it('does nothing without an email provider, a verified sender, or a recipient', async () => {
    mailOn = false
    expect(await queueWelcomeEmail(seed().asClient(), 'u1', 'a1')).toBe(false)
    mailOn = true
    delete process.env.EMAIL_FROM_ADDRESS
    expect(await queueWelcomeEmail(seed().asClient(), 'u1', 'a1')).toBe(false)
    process.env.EMAIL_FROM_ADDRESS = 'hello@ogadesk.com'
    expect(await queueWelcomeEmail(seed().asClient(), 'ghost', 'a1')).toBe(false)
  })
})

describe('queueQuotaEmail', () => {
  it('emails the workspace owner once per level per month', async () => {
    const db = seed()
    expect(await queueQuotaEmail(db.asClient(), 'a1', 80, '2026-11', 800, 1000)).toBe(true)
    expect(await queueQuotaEmail(db.asClient(), 'a1', 80, '2026-11', 850, 1000)).toBe(false)
    expect(await queueQuotaEmail(db.asClient(), 'a1', 100, '2026-11', 1000, 1000)).toBe(true)
    expect(await queueQuotaEmail(db.asClient(), 'a1', 80, '2026-12', 800, 1000)).toBe(true)
    expect(db.rows('crm_outbox').map((r) => r.dedupe_key)).toEqual([
      'once:email_quota_80:a1:2026-11',
      'once:email_quota_100:a1:2026-11',
      'once:email_quota_80:a1:2026-12',
    ])
    expect((db.rows('crm_outbox')[0].payload as { subject: string }).subject).toContain('80')
  })
})

describe('queueTrialEmail', () => {
  it('queues once per trial, in the owner\'s language', async () => {
    const { queueTrialEmail } = await import('./queue')
    const db = seed()
    expect(await queueTrialEmail(db.asClient(), 'a1', 'trial_ending', 'Pro', '2026-12-31T00:00:00Z', 3)).toBe(true)
    expect(await queueTrialEmail(db.asClient(), 'a1', 'trial_ending', 'Pro', '2026-12-31T00:00:00Z', 3)).toBe(false) // same trial: not again
    const [row] = db.rows('crm_outbox')
    expect(row).toMatchObject({ kind: 'email', account_id: 'a1', dedupe_key: 'once:email_trial_ending:a1:2026-12-31T00:00:00Z' })
    expect((row!.payload as { tags: string[]; subject: string }).tags).toEqual(['trial_ending'])
    expect((row!.payload as { subject: string }).subject).toContain('Pro') // French copy, plan name kept
  })
  it('sends nothing when email is off', async () => {
    const { queueTrialEmail } = await import('./queue')
    mailOn = false
    expect(await queueTrialEmail(seed().asClient(), 'a1', 'trial_ended', 'Pro', '2026-12-31')).toBe(false)
  })
})
