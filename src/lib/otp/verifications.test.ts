import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---- tiny in-memory stand-in for the Supabase query builder ----------------
type Row = Record<string, unknown>
class FakeDb {
  tables: Record<string, Row[]> = { otp_verifications: [], message_templates: [], messages: [] }
  from(table: string) {
    return new Builder(this, table)
  }
  rpc(name: string, args: { p_id: string; p_account: string }) {
    if (name !== 'otp_register_attempt') throw new Error(`unexpected rpc ${name}`)
    const r = this.tables.otp_verifications.find(
      (x) =>
        x.id === args.p_id &&
        x.account_id === args.p_account &&
        x.status === 'pending' &&
        new Date(x.expires_at as string).getTime() > Date.now() &&
        (x.attempts as number) < (x.max_attempts as number),
    )
    if (!r) return Promise.resolve({ data: [], error: null })
    r.attempts = (r.attempts as number) + 1
    return Promise.resolve({
      data: [{ code_hash: r.code_hash, attempts: r.attempts, max_attempts: r.max_attempts }],
      error: null,
    })
  }
}
class Builder {
  private filters: Array<(r: Row) => boolean> = []
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private payload: Row = {}
  private wantOne = false
  private orderKey: string | null = null
  private asc = true
  private limitN: number | null = null
  constructor(private db: FakeDb, private table: string) {}
  select() { return this }
  insert(p: Row) { this.op = 'insert'; this.payload = p; return this }
  update(p: Row) { this.op = 'update'; this.payload = p; return this }
  delete() { this.op = 'delete'; return this }
  eq(k: string, v: unknown) { this.filters.push((r) => r[k] === v); return this }
  neq(k: string, v: unknown) { this.filters.push((r) => r[k] !== v); return this }
  gte(k: string, v: string) { this.filters.push((r) => (r[k] as string) >= v); return this }
  lt(k: string, v: string) { this.filters.push((r) => (r[k] as string) < v); return this }
  order(k: string, o?: { ascending?: boolean }) { this.orderKey = k; this.asc = o?.ascending !== false; return this }
  limit(n: number) { this.limitN = n; return this }
  maybeSingle() { this.wantOne = true; return this.exec() }
  single() { this.wantOne = true; return this.exec() }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then(res: any, rej: any) { return this.exec().then(res, rej) }
  private async exec() {
    const rows = this.db.tables[this.table]
    if (this.op === 'insert') {
      const row = { created_at: new Date().toISOString(), attempts: 0, ...this.payload }
      rows.push(row)
      return { data: this.wantOne ? row : [row], error: null }
    }
    let matched = rows.filter((r) => this.filters.every((f) => f(r)))
    if (this.op === 'update') {
      matched.forEach((r) => Object.assign(r, this.payload))
    } else if (this.op === 'delete') {
      this.db.tables[this.table] = rows.filter((r) => !matched.includes(r))
      return { data: null, error: null }
    }
    if (this.orderKey) {
      const k = this.orderKey
      matched = [...matched].sort((a, b) => ((a[k] as string) < (b[k] as string) ? -1 : 1) * (this.asc ? 1 : -1))
    }
    if (this.limitN != null) matched = matched.slice(0, this.limitN)
    return { data: this.wantOne ? (matched[0] ?? null) : matched, error: null }
  }
}

const send = vi.fn()
vi.mock('@/lib/whatsapp/send-message', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/whatsapp/send-message')>()),
  sendMessageToConversation: (...args: unknown[]) => send(...args),
}))
vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: vi.fn(async () => ({ conversationId: 'conv-1', contactId: 'c-1', contactCreated: false, conversationCreated: false })),
}))
vi.mock('@/lib/whatsapp/resolve-config', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/whatsapp/resolve-config')>()),
  resolveWhatsAppConfig: vi.fn(async () => ({ id: 'cfg-1' })),
}))

const { createVerification, checkVerification, getVerification } = await import('./verifications')
const { ApiError } = await import('@/lib/api/v1/respond')
const { SendMessageError } = await import('@/lib/whatsapp/send-message')

const ACCOUNT = 'acc-1'
let db: FakeDb
const asDb = () => db as unknown as SupabaseClient

function template(over: Row = {}) {
  db.tables.message_templates.push({
    id: 't-1', account_id: ACCOUNT, name: 'otp_verification', language: 'en_US',
    status: 'APPROVED', category: 'Authentication', whatsapp_config_id: 'cfg-1', ...over,
  })
}
async function create(over: Record<string, unknown> = {}) {
  return createVerification(asDb(), ACCOUNT, { to: '+2348012345678', ...over })
}
const sentCode = () => (send.mock.calls.at(-1)![2] as { templateMessageParams: { body: string[] } }).templateMessageParams.body[0]

beforeEach(() => {
  db = new FakeDb()
  template()
  send.mockReset()
  send.mockResolvedValue({ messageId: 'msg-1', whatsappMessageId: 'wamid-1' })
})

describe('createVerification', () => {
  it('sends the code in OTP mode and stores only a hash', async () => {
    const { verification, whatsappMessageId } = await create()
    const code = sentCode()
    expect(code).toMatch(/^\d{6}$/)
    expect(send.mock.calls[0][2]).toMatchObject({ otp: true, messageType: 'template', templateName: 'otp_verification', whatsappConfigId: 'cfg-1' })
    expect(whatsappMessageId).toBe('wamid-1')
    expect(verification).toMatchObject({ status: 'pending', to: '+2348012345678', attempts_remaining: 5, message_id: 'msg-1' })
    expect(JSON.stringify(db.tables.otp_verifications)).not.toContain(code)
    expect(JSON.stringify(verification)).not.toContain(code)
  })

  it('uses a caller-supplied code and checks against it', async () => {
    const { verification } = await create({ code: 'AB12CD' })
    expect(sentCode()).toBe('AB12CD')
    expect((await checkVerification(asDb(), ACCOUNT, verification.id, 'AB12CD'))?.status).toBe('approved')
  })

  it('validates input', async () => {
    await expect(create({ to: '2348012345678' })).rejects.toBeInstanceOf(ApiError)
    await expect(create({ code: '12' })).rejects.toBeInstanceOf(ApiError)
    await expect(create({ ttlSeconds: 5 })).rejects.toBeInstanceOf(ApiError)
    await expect(create({ codeLength: 12 })).rejects.toBeInstanceOf(ApiError)
    await expect(create({ metadata: { x: 'y'.repeat(2000) } })).rejects.toBeInstanceOf(ApiError)
    expect(send).not.toHaveBeenCalled()
  })

  it('needs an approved authentication template', async () => {
    db.tables.message_templates = []
    await expect(create()).rejects.toMatchObject({ code: 'template_not_found', status: 404 })
    template({ status: 'PENDING' })
    await expect(create()).rejects.toMatchObject({ code: 'template_not_approved', status: 409 })
    db.tables.message_templates = []
    template({ category: 'Marketing' })
    await expect(create()).rejects.toMatchObject({ code: 'bad_request' })
  })

  it('throttles per phone number with Retry-After', async () => {
    for (let i = 0; i < 5; i++) await create()
    const err = await create().catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ code: 'otp_rate_limited', status: 429 })
    expect(Number(err.headers['Retry-After'])).toBeGreaterThan(0)
    // A different number is not throttled.
    await expect(createVerification(asDb(), ACCOUNT, { to: '+2348099999999' })).resolves.toBeTruthy()
  })

  it('a new code cancels the previous pending one, but only after a successful send', async () => {
    const first = (await create()).verification
    const firstCode = sentCode()
    send.mockRejectedValueOnce(new SendMessageError('meta_error', 'boom', 502))
    await expect(create()).rejects.toBeInstanceOf(SendMessageError)
    expect((await getVerification(asDb(), ACCOUNT, first.id))?.status).toBe('pending')
    expect((await checkVerification(asDb(), ACCOUNT, first.id, firstCode))?.status).toBe('approved')

    const second = (await create()).verification
    const third = (await create()).verification
    expect((await getVerification(asDb(), ACCOUNT, second.id))?.status).toBe('canceled')
    expect((await getVerification(asDb(), ACCOUNT, third.id))?.status).toBe('pending')
  })

  it('records a failed send and rethrows', async () => {
    send.mockRejectedValueOnce(new SendMessageError('meta_error', 'Meta API error: nope', 502))
    await expect(create()).rejects.toMatchObject({ code: 'meta_error' })
    expect(db.tables.otp_verifications[0]).toMatchObject({ status: 'failed', send_error: 'Meta API error: nope' })
  })
})

describe('checkVerification', () => {
  it('approves the right code', async () => {
    const { verification } = await create()
    expect(await checkVerification(asDb(), ACCOUNT, verification.id, sentCode())).toEqual({
      id: verification.id, status: 'approved', attempts_remaining: 4,
    })
  })

  it('counts wrong guesses and locks after the limit', async () => {
    const { verification } = await create()
    const real = sentCode()
    const wrong = real === '000000' ? '111111' : '000000'
    for (let i = 1; i <= 4; i++) {
      expect(await checkVerification(asDb(), ACCOUNT, verification.id, wrong)).toMatchObject({
        status: 'pending', attempts_remaining: 5 - i,
      })
    }
    expect(await checkVerification(asDb(), ACCOUNT, verification.id, wrong)).toMatchObject({ status: 'failed', attempts_remaining: 0 })
    // Even the right code is refused once locked.
    expect(await checkVerification(asDb(), ACCOUNT, verification.id, real)).toMatchObject({ status: 'failed' })
  })

  it('reports expired verifications', async () => {
    const { verification } = await create()
    db.tables.otp_verifications[0].expires_at = new Date(Date.now() - 1000).toISOString()
    expect(await checkVerification(asDb(), ACCOUNT, verification.id, sentCode())).toMatchObject({ status: 'expired' })
  })

  it('does not leak other accounts and tolerates bad ids', async () => {
    const { verification } = await create()
    expect(await checkVerification(asDb(), 'someone-else', verification.id, sentCode())).toBeNull()
    expect(await checkVerification(asDb(), ACCOUNT, 'not-a-uuid', '123456')).toBeNull()
    expect(await getVerification(asDb(), ACCOUNT, 'not-a-uuid')).toBeNull()
  })
})

describe('delivery status', () => {
  it("surfaces WhatsApp's reason when the message failed", async () => {
    const { verification } = await create()
    db.tables.messages.push({ id: 'msg-1', status: 'failed', error_code: 131026, error_title: 'Undeliverable', error_details: 'Not on WhatsApp' })
    expect((await getVerification(asDb(), ACCOUNT, verification.id))?.delivery).toEqual({
      status: 'failed',
      error: { code: 131026, title: 'Undeliverable', details: 'Not on WhatsApp' },
    })
  })
})
