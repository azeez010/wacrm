import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  createWa: vi.fn(),
  createEmail: vi.fn(),
  check: vi.fn(),
  todayCount: 0,
  consumeRows: [] as unknown[],
  updates: [] as { patch: unknown; ids: unknown }[],
  advanced: true,
}))

vi.mock('@/lib/otp/verifications', () => ({
  DEFAULT_OTP_TEMPLATE: 'otp_verification',
  createVerification: (...a: unknown[]) => h.createWa(...a),
  checkVerification: (...a: unknown[]) => h.check(...a),
}))
vi.mock('@/lib/otp/email-otp', () => ({
  emailCodesAvailable: () => true,
  createEmailVerification: (...a: unknown[]) => h.createEmail(...a),
}))
vi.mock('@/lib/billing/entitlements', () => ({
  assertFeature: vi.fn(async () => {
    if (!h.advanced) throw new Error('locked')
  }),
}))

import { ApiError } from '@/lib/api/v1/respond'
import { signToken } from '@/lib/otp/code'
import { channelsFor, confirmFormVerification, consumeProof, effectiveVerifyMode, maskEmail, maskPhone, startFormVerification } from './verify'

const form = { id: 'form-1', account_id: 'acc-1', name: 'Spring promo', kind: 'lead' as const }
const NOW = new Date('2026-11-26T12:00:00Z')
const rules = (verify: string) => ({ rules: { verify } }) as never

function fakeDb() {
  return {
    from: () => {
      let patch: unknown
      let isUpdate = false
      const b: Record<string, unknown> = {
        select: () => b,
        update: (p: unknown) => ((isUpdate = true), (patch = p), b),
        eq: () => b,
        neq: () => b,
        filter: () => b,
        gte: () => b,
        is: () => b,
        in: (_k: string, ids: unknown) => {
          h.updates.push({ patch, ids })
          return b
        },
        maybeSingle: () => Promise.resolve({ data: { status: 'approved' } }),
        then: (res: (v: unknown) => unknown) => Promise.resolve(isUpdate ? { data: h.consumeRows, error: null } : { count: h.todayCount, data: [], error: null }).then(res),
      }
      return b
    },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  h.todayCount = 0
  h.consumeRows = []
  h.updates = []
  h.advanced = true
  h.createWa.mockResolvedValue({ verification: { id: 'wa-1' }, contact: { id: 'c1', created: true } })
  h.createEmail.mockResolvedValue({ id: 'em-1', expiresAt: 'x' })
})

describe('helpers', () => {
  it('channels per mode, and masked destinations', () => {
    expect(channelsFor('both')).toEqual(['whatsapp', 'email'])
    expect(channelsFor('whatsapp')).toEqual(['whatsapp'])
    expect(channelsFor('off')).toEqual([])
    expect(channelsFor(undefined)).toEqual([])
    expect(maskPhone('+2348031234567')).toBe('+234••••••••67')
    expect(maskEmail('ada.lovelace@gmail.com')).toBe('a•••••@gmail.com')
  })
  it('is off for support buttons and for a plan without advanced forms', async () => {
    expect(await effectiveVerifyMode({} as never, { kind: 'lead', account_id: 'a' }, rules('whatsapp'))).toBe('whatsapp')
    expect(await effectiveVerifyMode({} as never, { kind: 'support', account_id: 'a' }, rules('whatsapp'))).toBe('off')
    h.advanced = false
    expect(await effectiveVerifyMode({} as never, { kind: 'lead', account_id: 'a' }, rules('both'))).toBe('off')
  })
})

describe('startFormVerification', () => {
  const input = { phone: '+2348031234567', email: 'Ada@Example.com' }

  it('sends one code per channel and returns a challenge with masked destinations', async () => {
    const r = await startFormVerification(fakeDb(), form, rules('both'), input, NOW)
    expect(r.kind).toBe('challenge')
    if (r.kind !== 'challenge') return
    expect(r.channels).toEqual(['whatsapp', 'email'])
    expect(r.masked).toEqual({ phone: '+234••••••••67', email: 'a••@example.com' })
    expect(h.createWa).toHaveBeenCalledWith(expect.anything(), 'acc-1', expect.objectContaining({ to: '+2348031234567', metadata: { purpose: 'form', form_id: 'form-1' } }))
    expect(h.createEmail).toHaveBeenCalledWith(expect.anything(), 'acc-1', expect.objectContaining({ email: 'ada@example.com', phone: '2348031234567' }))
  })

  it('needs an email for an email code, and nothing for "off"', async () => {
    expect(await startFormVerification(fakeDb(), form, rules('email'), { phone: '+2348031234567' }, NOW)).toEqual({ kind: 'error', error: 'email_required' })
    expect(await startFormVerification(fakeDb(), form, rules('off'), input, NOW)).toEqual({ kind: 'not_required' })
    expect(h.createWa).not.toHaveBeenCalled()
  })

  it('our own problems never cost a lead: a failed channel is dropped, and if nothing can be sent the lead is let through marked unverified', async () => {
    h.createWa.mockRejectedValue(new Error('template not approved'))
    const partial = await startFormVerification(fakeDb(), form, rules('both'), input, NOW)
    expect(partial).toMatchObject({ kind: 'challenge', channels: ['email'], dropped: ['whatsapp'] })

    h.createEmail.mockRejectedValue(new Error('provider down'))
    const none = await startFormVerification(fakeDb(), form, rules('both'), input, NOW)
    expect(none.kind).toBe('skipped')
    if (none.kind !== 'skipped') return
    // That proof is accepted at submit time, bound to this phone, and records what was dropped.
    const ok = await consumeProof(fakeDb(), form, none.proof, { phone: '+2348031234567', email: 'ada@example.com' }, NOW)
    expect(ok).toMatchObject({ ok: true, verified: { whatsapp: false, email: false, dropped: ['whatsapp', 'email'] } })
  })

  it('too many codes for one number is the visitor\'s problem, not ours', async () => {
    h.createWa.mockRejectedValue(new ApiError('otp_rate_limited', 'slow down', 429, { 'Retry-After': '120' }))
    expect(await startFormVerification(fakeDb(), form, rules('whatsapp'), input, NOW)).toEqual({ kind: 'error', error: 'rate_limited', retryAfter: 120 })
  })

  it('stops sending past the daily cap and lets the lead through unverified', async () => {
    h.todayCount = 500
    const r = await startFormVerification(fakeDb(), form, rules('both'), input, NOW)
    expect(r).toMatchObject({ kind: 'skipped', reason: 'daily_cap' })
    expect(h.createWa).not.toHaveBeenCalled()
  })
})

describe('confirmFormVerification', () => {
  async function challenge(mode = 'both') {
    const r = await startFormVerification(fakeDb(), form, rules(mode), { phone: '+2348031234567', email: 'ada@example.com' }, NOW)
    if (r.kind !== 'challenge') throw new Error('no challenge')
    return r.challenge
  }

  it('right codes give a proof; a wrong code stays pending; expiry and lock-out are reported', async () => {
    const ch = await challenge()
    h.check.mockResolvedValueOnce({ status: 'approved', attempts_remaining: 5 }).mockResolvedValueOnce({ status: 'approved', attempts_remaining: 5 })
    const ok = await confirmFormVerification(fakeDb(), form, ch, { whatsapp: '123456', email: '654321' }, NOW)
    expect(ok.kind).toBe('approved')

    h.check.mockResolvedValueOnce({ status: 'pending', attempts_remaining: 4 }).mockResolvedValueOnce({ status: 'approved', attempts_remaining: 5 })
    expect(await confirmFormVerification(fakeDb(), form, ch, { whatsapp: '000000', email: '654321' }, NOW)).toMatchObject({ kind: 'pending', wrong: ['whatsapp'], attemptsRemaining: { whatsapp: 4 } })

    h.check.mockResolvedValueOnce({ status: 'expired', attempts_remaining: 5 }).mockResolvedValueOnce({ status: 'approved', attempts_remaining: 5 })
    expect(await confirmFormVerification(fakeDb(), form, ch, { whatsapp: '123456', email: '654321' }, NOW)).toEqual({ kind: 'failed', reason: 'expired' })

    h.check.mockResolvedValueOnce({ status: 'failed', attempts_remaining: 0 }).mockResolvedValueOnce({ status: 'approved', attempts_remaining: 5 })
    expect(await confirmFormVerification(fakeDb(), form, ch, { whatsapp: '123456', email: '654321' }, NOW)).toEqual({ kind: 'failed', reason: 'too_many_attempts' })
  })

  it('an unreadable code counts as wrong, but a channel already confirmed needs no code again', async () => {
    const ch = await challenge()
    h.check.mockResolvedValue({ status: 'approved', attempts_remaining: 5 })
    // fakeDb says the row is already approved, so empty input for it is fine.
    expect((await confirmFormVerification(fakeDb(), form, ch, { whatsapp: '123456', email: '' }, NOW)).kind).toBe('approved')
  })

  it('a challenge from another form, a forged one or an expired one is invalid', async () => {
    const ch = await challenge()
    expect(await confirmFormVerification(fakeDb(), { id: 'other', account_id: 'acc-1' }, ch, { whatsapp: '1' }, NOW)).toEqual({ kind: 'invalid' })
    expect(await confirmFormVerification(fakeDb(), form, `${ch}x`, {}, NOW)).toEqual({ kind: 'invalid' })
    expect(await confirmFormVerification(fakeDb(), form, ch, {}, new Date(NOW.getTime() + 16 * 60_000))).toEqual({ kind: 'invalid' })
  })
})

describe('consumeProof', () => {
  const proof = (over: Record<string, unknown> = {}, ttl = 1200) =>
    signToken('vp', { f: 'form-1', ph: '2348031234567', em: 'ada@example.com', ids: { whatsapp: 'wa-1', email: 'em-1' }, ...over }, ttl, NOW.getTime())
  const submitted = { phone: '+2348031234567', email: 'ADA@example.com' }
  const rows = [{ id: 'wa-1', channel: 'whatsapp', metadata: { contact_created: true } }, { id: 'em-1', channel: 'email', metadata: null }]

  it('accepts a matching proof once, spending the verifications, and remembers the code created the contact', async () => {
    h.consumeRows = rows
    const r = await consumeProof(fakeDb(), form, proof(), submitted, NOW)
    expect(r).toEqual({ ok: true, verified: { whatsapp: true, email: true, contactCreatedByCode: true } })
    expect(h.updates[0]).toMatchObject({ patch: { consumed_at: NOW.toISOString() }, ids: ['wa-1', 'em-1'] })
  })

  it('a replay finds nothing left to spend and is refused', async () => {
    h.consumeRows = []
    expect(await consumeProof(fakeDb(), form, proof(), submitted, NOW)).toEqual({ ok: false })
    h.consumeRows = [rows[0]] // only one of the two was still unspent
    expect(await consumeProof(fakeDb(), form, proof(), submitted, NOW)).toEqual({ ok: false })
  })

  it('refuses a proof for another form, another phone, another email, or an expired one', async () => {
    h.consumeRows = rows
    expect(await consumeProof(fakeDb(), { id: 'other', account_id: 'acc-1' }, proof(), submitted, NOW)).toEqual({ ok: false })
    expect(await consumeProof(fakeDb(), form, proof(), { ...submitted, phone: '+2348039999999' }, NOW)).toEqual({ ok: false })
    expect(await consumeProof(fakeDb(), form, proof(), { ...submitted, email: 'someone@else.com' }, NOW)).toEqual({ ok: false })
    expect(await consumeProof(fakeDb(), form, proof({}, 60), submitted, new Date(NOW.getTime() + 120_000))).toEqual({ ok: false })
    expect(await consumeProof(fakeDb(), form, undefined, submitted, NOW)).toEqual({ ok: false })
    expect(h.updates).toHaveLength(0)
  })
})
