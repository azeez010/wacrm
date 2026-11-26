import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  form: null as Record<string, unknown> | null,
  mode: 'whatsapp' as string,
  start: vi.fn(),
  confirm: vi.fn(),
  validate: vi.fn(),
  turnstile: true,
  rate: true,
}))

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => void fn() }))
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({}) }))
vi.mock('@/lib/forms/public-config', () => ({ loadFormByPublicId: vi.fn(async () => h.form) }))
vi.mock('@/lib/forms/definitions', () => ({ loadFormDefinitions: vi.fn(async () => ({ customFields: new Map(), tableColumns: new Map(), refFields: new Map() })) }))
vi.mock('@/lib/forms/validate-answers', () => ({ validateAnswers: (...a: unknown[]) => h.validate(...a) }))
vi.mock('@/lib/forms/public-http', async (orig) => ({ ...(await orig<typeof import('@/lib/forms/public-http')>()), verifyTurnstile: vi.fn(async () => h.turnstile) }))
vi.mock('@/lib/forms/verify', () => ({
  effectiveVerifyMode: vi.fn(async () => h.mode),
  startFormVerification: (...a: unknown[]) => h.start(...a),
  confirmFormVerification: (...a: unknown[]) => h.confirm(...a),
  purgeUnverifiedFormContacts: vi.fn(async () => 0),
}))
vi.mock('@/lib/rate-limit', async (orig) => ({
  ...(await orig<typeof import('@/lib/rate-limit')>()),
  checkRateLimit: vi.fn(() => ({ success: h.rate, limit: 8, remaining: 0, resetAt: Date.now() + 1000 })),
}))

import { POST as startPost } from './[publicId]/verify/start/route'
import { POST as confirmPost } from './[publicId]/verify/confirm/route'

const params = { params: Promise.resolve({ publicId: 'abc' }) }
const req = (body: unknown) => new Request('http://x/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const json = async (r: Response) => ({ status: r.status, body: await r.json() })

beforeEach(() => {
  vi.clearAllMocks()
  h.form = { id: 'f1', account_id: 'a1', kind: 'lead', name: 'Spring', status: 'active', archived_at: null, fields: [], settings: { rules: { verify: 'whatsapp' } } }
  h.mode = 'whatsapp'
  h.turnstile = true
  h.rate = true
  h.validate.mockReturnValue({ ok: true, errors: {}, phone: '+2348031234567', email: 'a@b.co' })
  h.start.mockResolvedValue({ kind: 'challenge', challenge: 'tok', channels: ['whatsapp'], masked: { phone: '+234••67' }, dropped: [] })
})

describe('POST /verify/start', () => {
  it('validates the answers first, then sends and returns the challenge', async () => {
    const r = await json(await startPost(req({ answers: { phone: '0803' } }), params))
    expect(r).toMatchObject({ status: 200, body: { ok: true, required: true, challenge: 'tok', channels: ['whatsapp'], resendAfter: 30 } })
    expect(h.validate).toHaveBeenCalled()
  })

  it('sends nothing for invalid answers (garbage never triggers a message)', async () => {
    h.validate.mockReturnValue({ ok: false, errors: { phone: 'invalid_phone' }, phone: null })
    const r = await json(await startPost(req({ answers: {} }), params))
    expect(r).toMatchObject({ status: 400, body: { error: 'invalid', errors: { phone: 'invalid_phone' } } })
    expect(h.start).not.toHaveBeenCalled()
  })

  it('needs no code when the form does not verify', async () => {
    h.mode = 'off'
    expect((await json(await startPost(req({ answers: {} }), params))).body).toEqual({ ok: true, required: false })
    expect(h.start).not.toHaveBeenCalled()
  })

  it('stops bots (honeypot), failed captchas, closed forms and rate limits before any send', async () => {
    expect((await json(await startPost(req({ answers: {}, website: 'http://spam' }), params))).status).toBe(400)
    h.form = { ...h.form!, settings: { rules: { verify: 'whatsapp', turnstile: true } } }
    h.turnstile = false
    expect((await json(await startPost(req({ answers: {} }), params))).body).toMatchObject({ error: 'captcha' })
    h.turnstile = true
    h.form = { ...h.form!, status: 'paused' }
    expect((await json(await startPost(req({ answers: {} }), params))).status).toBe(410)
    h.rate = false
    expect((await json(await startPost(req({ answers: {} }), params))).status).toBe(429)
    expect(h.start).not.toHaveBeenCalled()
  })

  it('passes through "we could not send, lead goes through unverified" and the per-number limit', async () => {
    h.start.mockResolvedValue({ kind: 'skipped', proof: 'proof-tok', reason: 'quota' })
    expect((await json(await startPost(req({ answers: {} }), params))).body).toMatchObject({ ok: true, skipped: true, proof: 'proof-tok' })
    h.start.mockResolvedValue({ kind: 'error', error: 'rate_limited', retryAfter: 90 })
    const r = await startPost(req({ answers: {} }), params)
    expect(r.status).toBe(429)
    expect(r.headers.get('Retry-After')).toBe('90')
  })

  it('unknown forms are 404', async () => {
    h.form = null
    expect((await json(await startPost(req({ answers: {} }), params))).status).toBe(404)
  })
})

describe('POST /verify/confirm', () => {
  it('maps every outcome', async () => {
    h.confirm.mockResolvedValueOnce({ kind: 'approved', proof: 'p' })
    expect((await json(await confirmPost(req({ challenge: 'c', codes: { whatsapp: '123456' } }), params))).body).toEqual({ ok: true, status: 'approved', proof: 'p' })
    h.confirm.mockResolvedValueOnce({ kind: 'pending', wrong: ['whatsapp'], attemptsRemaining: { whatsapp: 3 } })
    expect((await json(await confirmPost(req({ challenge: 'c', codes: {} }), params))).body).toMatchObject({ status: 'pending', wrong: ['whatsapp'] })
    h.confirm.mockResolvedValueOnce({ kind: 'failed', reason: 'expired' })
    expect((await json(await confirmPost(req({ challenge: 'c', codes: {} }), params))).body).toMatchObject({ status: 'expired' })
    h.confirm.mockResolvedValueOnce({ kind: 'failed', reason: 'too_many_attempts' })
    expect((await json(await confirmPost(req({ challenge: 'c', codes: {} }), params))).body).toMatchObject({ status: 'failed' })
    h.confirm.mockResolvedValueOnce({ kind: 'invalid' })
    expect((await json(await confirmPost(req({ challenge: 'bad' }), params))).status).toBe(400)
  })
  it('is rate limited', async () => {
    h.rate = false
    expect((await json(await confirmPost(req({}), params))).status).toBe(429)
  })
})
