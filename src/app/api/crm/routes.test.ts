import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from '@/test-utils/fake-db'

let admin: FakeDb
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => admin }))
const flushOutbox = vi.fn()
const enqueue = vi.fn()
vi.mock('@/lib/crm/outbox', () => ({ flushOutbox: (...a: unknown[]) => flushOutbox(...a), enqueue: (...a: unknown[]) => enqueue(...a) }))
let crmOn = true
vi.mock('@/lib/crm/registry', () => ({ isCrmEnabled: () => crmOn }))

const flush = await import('./flush/route')
const resync = await import('./resync/route')
const brevo = await import('./webhooks/brevo/route')

const withSecret = (secret?: string) => new Request('https://x.test/api/crm/flush', { method: 'POST', headers: secret ? { 'x-cron-secret': secret } : {} })

beforeEach(() => {
  process.env.AUTOMATION_CRON_SECRET = 'cron-secret'
  process.env.BREVO_WEBHOOK_TOKEN = 'hook-token'
  crmOn = true
  flushOutbox.mockReset().mockResolvedValue({ claimed: 0, sent: 0, retried: 0, dead: 0 })
  enqueue.mockReset().mockResolvedValue(true)
  admin = new FakeDb({}, { profiles: [{ user_id: 'u1', email: 'jane@example.com', marketing_opt_in: true, created_at: '1' }, { user_id: 'u2', email: 'bob@example.com', marketing_opt_in: true, created_at: '2' }] })
})

describe('/api/crm/flush', () => {
  it('requires the cron secret', async () => {
    expect((await flush.POST(withSecret())).status).toBe(403)
    expect((await flush.POST(withSecret('wrong'))).status).toBe(403)
    delete process.env.AUTOMATION_CRON_SECRET
    expect((await flush.POST(withSecret('anything'))).status).toBe(503)
    expect(flushOutbox).not.toHaveBeenCalled()
  })

  it('drains in batches until the queue is empty and reports totals', async () => {
    flushOutbox.mockResolvedValueOnce({ claimed: 20, sent: 18, retried: 1, dead: 1 }).mockResolvedValueOnce({ claimed: 3, sent: 3, retried: 0, dead: 0 })
    const res = await flush.GET(withSecret('cron-secret'))
    expect(await res.json()).toEqual({ claimed: 23, sent: 21, retried: 1, dead: 1 })
    expect(flushOutbox).toHaveBeenCalledTimes(2)
  })
})

describe('/api/crm/resync', () => {
  it('queues every user, and refuses without a secret or a provider', async () => {
    expect((await resync.POST(withSecret())).status).toBe(403)
    crmOn = false
    expect((await resync.POST(withSecret('cron-secret'))).status).toBe(409)
    crmOn = true
    const res = await resync.POST(withSecret('cron-secret'))
    expect(await res.json()).toEqual({ queued: 2 })
    expect(enqueue).toHaveBeenCalledWith(admin, { kind: 'contact', userId: 'u1', dedupeKey: 'contact:u1' })
  })
})

describe('/api/crm/webhooks/brevo', () => {
  const hook = (body: unknown, token = 'hook-token') =>
    brevo.POST(new Request(`https://x.test/api/crm/webhooks/brevo?token=${token}`, { method: 'POST', body: JSON.stringify(body) }))

  it('turns off marketing consent on unsubscribe, spam complaints and hard bounces', async () => {
    for (const event of ['unsubscribe', 'spam', 'hard_bounce']) {
      admin.rows('profiles')[0].marketing_opt_in = true
      expect(await (await hook({ event, email: 'JANE@example.com' })).json()).toEqual({ ok: true, changed: true })
      expect(admin.rows('profiles')[0]).toMatchObject({ marketing_opt_in: false })
    }
    expect(admin.rows('profiles')[1].marketing_opt_in).toBe(true)
  })

  it('ignores other events and rejects a wrong token', async () => {
    expect(await (await hook({ event: 'delivered', email: 'bob@example.com' })).json()).toEqual({ ok: true, changed: false })
    expect(admin.rows('profiles')[1].marketing_opt_in).toBe(true)
    expect((await hook({ event: 'unsubscribe', email: 'bob@example.com' }, 'nope')).status).toBe(403)
    delete process.env.BREVO_WEBHOOK_TOKEN
    expect((await hook({ event: 'unsubscribe', email: 'bob@example.com' })).status).toBe(503)
  })
})
