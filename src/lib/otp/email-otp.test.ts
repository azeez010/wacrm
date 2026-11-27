import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  provider: { name: 'fake', send: vi.fn(async () => ({ id: 'x' })) } as { name: string; send: ReturnType<typeof vi.fn> } | null,
  sender: { email: 'no.reply@ogadesk.com', name: 'OgaDesk' } as { email: string; name?: string } | null,
  recent: [] as { created_at: string }[],
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/crm/registry', () => ({ isEmailEnabled: () => !!h.provider, getEmailProvider: () => h.provider }))
vi.mock('@/lib/email/queue', () => ({ sender: () => h.sender }))

import { ApiError } from '@/lib/api/v1/respond'
import { createEmailVerification, emailCodesAvailable } from './email-otp'

const db = {
  from: () => {
    let op = 'select'
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (row: Record<string, unknown>) => ((op = 'insert'), h.inserts.push(row), Promise.resolve({ error: null })),
      update: (p: Record<string, unknown>) => ((op = 'update'), h.updates.push(p), b),
      eq: () => b,
      neq: () => b,
      gte: () => b,
      order: () => Promise.resolve({ data: h.recent, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null, data: op === 'select' ? h.recent : null }).then(res),
    }
    return b
  },
} as never

beforeEach(() => {
  vi.clearAllMocks()
  h.provider = { name: 'fake', send: vi.fn(async () => ({ id: 'x' })) }
  h.sender = { email: 'no.reply@ogadesk.com', name: 'OgaDesk' }
  h.recent = []
  h.inserts = []
  h.updates = []
})

describe('email codes', () => {
  it('are only available when a provider and a sender are configured', async () => {
    expect(await emailCodesAvailable()).toBe(true)
    h.provider = null
    expect(await emailCodesAvailable()).toBe(false)
    h.provider = { name: 'fake', send: vi.fn() }
    h.sender = null
    expect(await emailCodesAvailable()).toBe(false)
  })

  it('stores only a hash, sends the code straight away, and lowercases the address', async () => {
    const r = await createEmailVerification(db, 'acc-1', { email: ' Ada@Example.COM ', phone: '2348031234567', formName: 'Spring promo', locale: 'fr' })
    expect(h.inserts[0]).toMatchObject({ account_id: 'acc-1', channel: 'email', email: 'ada@example.com', phone: '2348031234567', status: 'pending' })
    expect(JSON.stringify(h.inserts[0])).not.toMatch(/"code":/)
    expect(h.inserts[0].code_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(r.id).toBe(h.inserts[0].id)
    const sent = h.provider!.send.mock.calls[0][0] as { to: { email: string }; subject: string; html: string; text: string }
    expect(sent.to.email).toBe('ada@example.com')
    const code = sent.subject.match(/\d{6}/)?.[0]
    expect(code).toBeTruthy()
    expect(sent.text).toContain(code)
    expect(sent.html).toContain(code)
    expect(sent.text).toContain('Spring promo')
  })

  it('refuses a bad address, a missing provider, and too many codes for one address', async () => {
    await expect(createEmailVerification(db, 'a', { email: 'nope', phone: '1', formName: 'F' })).rejects.toMatchObject({ code: 'bad_request' })
    h.provider = null
    await expect(createEmailVerification(db, 'a', { email: 'a@b.co', phone: '1', formName: 'F' })).rejects.toMatchObject({ code: 'unavailable' })
    h.provider = { name: 'fake', send: vi.fn() }
    h.recent = Array.from({ length: 5 }, () => ({ created_at: new Date().toISOString() }))
    const err = await createEmailVerification(db, 'a', { email: 'a@b.co', phone: '1', formName: 'F' }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('otp_rate_limited')
    expect(h.provider.send).not.toHaveBeenCalled()
  })

  it('marks the code failed (and rethrows) when the provider cannot send', async () => {
    h.provider = { name: 'fake', send: vi.fn(async () => { throw new Error('brevo 500') }) }
    await expect(createEmailVerification(db, 'a', { email: 'a@b.co', phone: '1', formName: 'F' })).rejects.toThrow('brevo 500')
    expect(h.updates[0]).toMatchObject({ status: 'failed', send_error: 'brevo 500' })
  })
})
