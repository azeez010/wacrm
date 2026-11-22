import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb, type Row } from '@/test-utils/fake-db'
import { CrmError } from './types'

const upsertContact = vi.fn()
const trackEvent = vi.fn()
const send = vi.fn()
let crmOn = true
let mailOn = true
vi.mock('./registry', () => ({
  getCrmProvider: () => (crmOn ? { name: 't', ensureSchema: vi.fn(), upsertContact, trackEvent } : null),
  getEmailProvider: () => (mailOn ? { name: 't', send } : null),
  isCrmEnabled: () => crmOn,
  isEmailEnabled: () => mailOn,
}))
const buildContactSnapshot = vi.fn()
vi.mock('./snapshot', () => ({ buildContactSnapshot: (...a: unknown[]) => buildContactSnapshot(...a) }))

const { enqueue, flushOutbox, BACKOFF_SECONDS, MAX_ATTEMPTS } = await import('./outbox')

const NOW = Date.parse('2026-11-20T10:00:00Z')

/** crm_claim_outbox as the SQL function does it (attempt counted at claim). */
function claim(args: Record<string, unknown>, db: FakeDb) {
  const due = db
    .rows('crm_outbox')
    .filter(
      (r) =>
        (r.status === 'pending' && (r.next_attempt_at as string) <= new Date(NOW).toISOString()) ||
        (r.status === 'processing' && (r.locked_at as string) < new Date(NOW - 10 * 60_000).toISOString()),
    )
    .slice(0, args.p_limit as number)
  due.forEach((r) => {
    r.status = 'processing'
    r.locked_at = new Date(NOW).toISOString()
    r.attempts = (r.attempts as number) + 1
  })
  return due.map((r) => ({ ...r }))
}

function makeDb(rows: Row[] = [], extra: Record<string, Row[]> = {}) {
  return new FakeDb(
    {
      isDuplicate: (t, row, existing) =>
        t === 'crm_outbox' && row.dedupe_key != null && existing.some((r) => r.dedupe_key === row.dedupe_key && (r.status ?? 'pending') === 'pending'),
      rpc: { crm_claim_outbox: claim },
    },
    {
      crm_outbox: rows,
      profiles: [{ user_id: 'u1', email: 'Jane@Example.com' }],
      accounts: [{ id: 'a1', owner_user_id: 'u1' }],
      ...extra,
    },
  )
}

const job = (over: Row = {}): Row => ({
  id: crypto.randomUUID(),
  kind: 'contact',
  user_id: 'u1',
  account_id: null,
  dedupe_key: null,
  payload: {},
  status: 'pending',
  attempts: 0,
  next_attempt_at: new Date(NOW - 1000).toISOString(),
  created_at: new Date(NOW - 5000).toISOString(),
  ...over,
})

beforeEach(() => {
  crmOn = true
  mailOn = true
  upsertContact.mockReset().mockResolvedValue(undefined)
  trackEvent.mockReset().mockResolvedValue(undefined)
  send.mockReset().mockResolvedValue({})
  buildContactSnapshot.mockReset().mockResolvedValue({ externalId: 'u1', email: 'jane@example.com', attributes: {}, lists: [] })
})

describe('enqueue', () => {
  it('collapses repeats while a job with the same key is pending', async () => {
    const db = makeDb()
    expect(await enqueue(db.asClient(), { kind: 'contact', userId: 'u1', dedupeKey: 'contact:u1' })).toBe(true)
    expect(await enqueue(db.asClient(), { kind: 'contact', userId: 'u1', dedupeKey: 'contact:u1' })).toBe(false)
    expect(db.rows('crm_outbox')).toHaveLength(1)
    // Once it is no longer pending a new one is accepted.
    db.rows('crm_outbox')[0].status = 'sent'
    expect(await enqueue(db.asClient(), { kind: 'contact', userId: 'u1', dedupeKey: 'contact:u1' })).toBe(true)
  })

  it('never dedupes jobs without a key', async () => {
    const db = makeDb()
    await enqueue(db.asClient(), { kind: 'event', userId: 'u1', payload: { name: 'x' } })
    await enqueue(db.asClient(), { kind: 'event', userId: 'u1', payload: { name: 'x' } })
    expect(db.rows('crm_outbox')).toHaveLength(2)
  })
})

describe('flushOutbox', () => {
  it('syncs a contact from a fresh snapshot and marks the job sent', async () => {
    const db = makeDb([job()])
    const r = await flushOutbox(db.asClient(), 10, NOW)
    expect(r).toMatchObject({ claimed: 1, sent: 1, retried: 0, dead: 0 })
    expect(buildContactSnapshot).toHaveBeenCalledWith(expect.anything(), 'u1')
    expect(upsertContact).toHaveBeenCalledTimes(1)
    expect(db.rows('crm_outbox')[0]).toMatchObject({ status: 'sent', last_error: null })
  })

  it('syncs the contact before tracking events about it, and sends emails last', async () => {
    const calls: string[] = []
    upsertContact.mockImplementation(async () => void calls.push('contact'))
    trackEvent.mockImplementation(async () => void calls.push('event'))
    send.mockImplementation(async () => void calls.push('email'))
    const db = makeDb([
      job({ kind: 'email', payload: { to: { email: 'a@b.c' } }, created_at: new Date(NOW - 9000).toISOString() }),
      job({ kind: 'event', payload: { name: 'whatsapp_connected' }, created_at: new Date(NOW - 8000).toISOString() }),
      job({ kind: 'contact' }),
    ])
    await flushOutbox(db.asClient(), 10, NOW)
    expect(calls).toEqual(['contact', 'event', 'email'])
    expect(trackEvent).toHaveBeenCalledWith({ name: 'whatsapp_connected', email: 'jane@example.com', at: undefined, properties: undefined })
  })

  it("addresses an account-level event to the workspace owner", async () => {
    const db = makeDb([job({ kind: 'event', user_id: null, account_id: 'a1', payload: { name: 'quota_80' } })])
    await flushOutbox(db.asClient(), 10, NOW)
    expect(trackEvent).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@example.com' }))
  })

  it('skips (and finishes) a job whose user no longer exists', async () => {
    buildContactSnapshot.mockResolvedValue(null)
    const db = makeDb([job()])
    await flushOutbox(db.asClient(), 10, NOW)
    expect(upsertContact).not.toHaveBeenCalled()
    expect(db.rows('crm_outbox')[0].status).toBe('sent')
  })

  it('retries a retryable failure with growing backoff', async () => {
    upsertContact.mockRejectedValue(new CrmError('Brevo 503', true, 503))
    const db = makeDb([job()])
    const r1 = await flushOutbox(db.asClient(), 10, NOW)
    expect(r1).toMatchObject({ retried: 1, dead: 0 })
    const row = db.rows('crm_outbox')[0]
    expect(row).toMatchObject({ status: 'pending', attempts: 1, last_error: 'Brevo 503' })
    expect(Date.parse(row.next_attempt_at as string)).toBe(NOW + BACKOFF_SECONDS[0] * 1000)

    // Not due yet: nothing happens. Due later: second attempt waits longer.
    expect((await flushOutbox(db.asClient(), 10, NOW + 30_000)).claimed).toBe(0)
    row.next_attempt_at = new Date(NOW).toISOString()
    await flushOutbox(db.asClient(), 10, NOW)
    expect(Date.parse(row.next_attempt_at as string)).toBe(NOW + BACKOFF_SECONDS[1] * 1000)
  })

  it('gives up immediately on a non-retryable error', async () => {
    trackEvent.mockRejectedValue(new CrmError('Brevo 400: bad event', false, 400))
    const db = makeDb([job({ kind: 'event', payload: { name: 'x' } })])
    expect(await flushOutbox(db.asClient(), 10, NOW)).toMatchObject({ dead: 1, retried: 0 })
    expect(db.rows('crm_outbox')[0]).toMatchObject({ status: 'dead', last_error: 'Brevo 400: bad event' })
  })

  it('goes dead after the maximum number of attempts', async () => {
    upsertContact.mockRejectedValue(new CrmError('Brevo 503', true, 503))
    const db = makeDb([job({ attempts: MAX_ATTEMPTS - 1 })])
    expect(await flushOutbox(db.asClient(), 10, NOW)).toMatchObject({ dead: 1 })
    expect(db.rows('crm_outbox')[0].status).toBe('dead')
  })

  it('retakes jobs stuck in processing after a crash', async () => {
    const db = makeDb([job({ status: 'processing', locked_at: new Date(NOW - 11 * 60_000).toISOString() })])
    expect((await flushOutbox(db.asClient(), 10, NOW)).sent).toBe(1)
  })

  it('leaves the queue untouched when no provider is configured', async () => {
    crmOn = false
    mailOn = false
    const db = makeDb([job()])
    expect(await flushOutbox(db.asClient(), 10, NOW)).toEqual({ claimed: 0, sent: 0, retried: 0, dead: 0 })
    expect(db.rows('crm_outbox')[0]).toMatchObject({ status: 'pending', attempts: 0 })
  })

  it('treats an unexpected (non-CrmError) failure as retryable', async () => {
    upsertContact.mockRejectedValue(new Error('socket hang up'))
    const db = makeDb([job()])
    expect(await flushOutbox(db.asClient(), 10, NOW)).toMatchObject({ retried: 1 })
  })

  it('drops old finished jobs', async () => {
    const db = makeDb([
      job({ status: 'sent', sent_at: new Date(NOW - 20 * 86400_000).toISOString() }),
      job({ status: 'sent', sent_at: new Date(NOW - 1 * 86400_000).toISOString() }),
    ])
    await flushOutbox(db.asClient(), 10, NOW)
    expect(db.rows('crm_outbox')).toHaveLength(1)
  })
})
