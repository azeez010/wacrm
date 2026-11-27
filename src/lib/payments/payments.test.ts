import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { COUNTRY_CURRENCY } from '@/lib/currency/supported'
import { PAYMENT_COUNTRY_CURRENCY, paymentType, PAYMENT_TYPES } from './catalogue'
import { applyEvent, cancelRenewal, startCheckout, type Deps } from './checkout'
import { manualTransferDriver } from './drivers/manual-transfer'
import { paystackDriver } from './drivers/paystack'
import { decryptSecretsObject, encryptPlatformSecret } from './secrets'
import { PaymentError, type DriverContext } from './types'

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)))
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const ctx = (over: Partial<DriverContext> = {}): DriverContext => ({ instanceId: 'i1', mode: 'test', config: {}, secrets: { secret_key: 'sk_test_abc' }, fetch: vi.fn(), ...over })

async function hmac(secret: string, body: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('catalogue', () => {
  it('every type has unique kind, fields and at least one method', () => {
    expect(new Set(PAYMENT_TYPES.map((t) => t.kind)).size).toBe(PAYMENT_TYPES.length)
    for (const t of PAYMENT_TYPES) expect(t.methods.length).toBeGreaterThan(0)
  })
  it('Paystack coverage follows the account country, USD and international cards', () => {
    const p = paymentType('paystack')!
    expect(p.coverage({ merchant_country: 'NG', usd_enabled: true })).toEqual({ countries: ['NG', '*'], currencies: ['NGN', 'USD'] })
    expect(p.coverage({ merchant_country: 'GH', usd_enabled: true, international_cards: false })).toEqual({ countries: ['GH'], currencies: ['GHS'] })
    expect(p.coverage({})).toEqual({ countries: ['NG', '*'], currencies: ['NGN'] })
  })
  it('Paystack rejects a key that does not match the mode', () => {
    const p = paymentType('paystack')!
    expect(p.validate!({}, { secret_key: 'sk_live_x' }, 'test')).toHaveLength(1)
    expect(p.validate!({}, { secret_key: 'sk_live_x' }, 'live')).toEqual([])
  })
  it('country currencies match the price-display map exactly', () => {
    expect(PAYMENT_COUNTRY_CURRENCY).toEqual(COUNTRY_CURRENCY)
  })
  it('manual transfer covers its bank country and currency', () => {
    expect(paymentType('manual_transfer')!.coverage({ country: 'GH', currency: 'GHS' })).toEqual({ countries: ['GH'], currencies: ['GHS'] })
  })
})

describe('platform secrets', () => {
  it('round-trips and fails with the wrong key', async () => {
    const blob = await encryptPlatformSecret(JSON.stringify({ secret_key: 'sk_test_1' }), KEY)
    expect(await decryptSecretsObject(blob, KEY)).toEqual({ secret_key: 'sk_test_1' })
    const other = btoa(String.fromCharCode(...new Uint8Array(32)))
    await expect(decryptSecretsObject(blob, other)).rejects.toThrow()
    expect(await decryptSecretsObject(null, KEY)).toEqual({})
    await expect(decryptSecretsObject(blob, '')).rejects.toThrow(/PLATFORM_SECRETS_KEY/)
  })
})

describe('paystack driver', () => {
  it('initialises a checkout in subunits with our reference, callback and plan', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { status: true, data: { authorization_url: 'https://checkout.paystack.com/x', reference: 'ogd_a_1' } }))
    const r = await paystackDriver.createCheckout(ctx({ fetch: f }), {
      reference: 'ogd_a_1', sessionReference: 'ogd_a', method: 'subscription', amount: 15000, currency: 'NGN', email: 'a@x.ng',
      plan: { id: 'starter', name: 'Starter' }, interval: 'monthly', callbackUrl: 'https://ogadesk.com/settings/billing/return?ref=ogd_a', providerPlanId: 'PLN_1',
    })
    expect(r).toEqual({ kind: 'redirect', url: 'https://checkout.paystack.com/x', providerReference: 'ogd_a_1' })
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('https://api.paystack.co/transaction/initialize')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk_test_abc')
    expect(JSON.parse(init.body)).toMatchObject({ amount: 1500000, currency: 'NGN', reference: 'ogd_a_1', plan: 'PLN_1', metadata: { checkout_reference: 'ogd_a' } })
  })
  it('maps failures: 5xx/network retryable, 4xx not', async () => {
    const fail = async (f: DriverContext['fetch']) => paystackDriver.createCheckout(ctx({ fetch: f }), { reference: 'r', sessionReference: 's', method: 'checkout_link', amount: 1, currency: 'NGN', email: 'e', plan: { id: 'p', name: 'P' }, interval: 'monthly', callbackUrl: 'u' }).catch((e) => e)
    expect(await fail(vi.fn().mockResolvedValue(json(503, { status: false, message: 'down' })))).toMatchObject({ retryable: true, status: 503 })
    expect(await fail(vi.fn().mockResolvedValue(json(401, { status: false, message: 'Invalid key' })))).toMatchObject({ retryable: false, status: 401 })
    expect(await fail(vi.fn().mockRejectedValue(new Error('ECONNRESET')))).toMatchObject({ retryable: true })
    expect(await paystackDriver.createCheckout(ctx({ secrets: {} }), { reference: 'r', sessionReference: 's', method: 'checkout_link', amount: 1, currency: 'NGN', email: 'e', plan: { id: 'p', name: 'P' }, interval: 'monthly', callbackUrl: 'u' }).catch((e) => e)).toBeInstanceOf(PaymentError)
  })
  it('verifies the webhook signature and normalises events', async () => {
    const body = JSON.stringify({ event: 'charge.success', data: { reference: 'ogd_a_1', amount: 1500000, currency: 'NGN', customer: { customer_code: 'CUS_1' }, metadata: { checkout_reference: 'ogd_a' } } })
    const ok = await paystackDriver.parseWebhook!(ctx(), body, new Headers({ 'x-paystack-signature': await hmac('sk_test_abc', body) }))
    expect(ok).toEqual({ type: 'payment.succeeded', providerReference: 'ogd_a_1', amount: 15000, currency: 'NGN', customerId: 'CUS_1', planId: undefined, sessionReference: 'ogd_a', subscriptionId: undefined })
    await expect(paystackDriver.parseWebhook!(ctx(), body, new Headers({ 'x-paystack-signature': 'bad' }))).rejects.toMatchObject({ status: 401 })
    await expect(paystackDriver.parseWebhook!(ctx(), body + ' ', new Headers({ 'x-paystack-signature': await hmac('sk_test_abc', body) }))).rejects.toMatchObject({ status: 401 })
    const sub = JSON.stringify({ event: 'subscription.create', data: { subscription_code: 'SUB_1', email_token: 'tok', customer: { customer_code: 'CUS_1' }, plan: { plan_code: 'PLN_1' } } })
    expect(await paystackDriver.parseWebhook!(ctx(), sub, new Headers({ 'x-paystack-signature': await hmac('sk_test_abc', sub) })))
      .toEqual({ type: 'subscription.created', subscriptionId: 'SUB_1', customerId: 'CUS_1', planId: 'PLN_1', meta: { emailToken: 'tok' } })
    const other = JSON.stringify({ event: 'transfer.success', data: {} })
    expect(await paystackDriver.parseWebhook!(ctx(), other, new Headers({ 'x-paystack-signature': await hmac('sk_test_abc', other) }))).toEqual({ type: 'ignored', event: 'transfer.success' })
  })
  it('verify maps Paystack statuses', async () => {
    const v = (status: string) => paystackDriver.verify!(ctx({ fetch: vi.fn().mockResolvedValue(json(200, { status: true, data: { status, amount: 100, currency: 'NGN' } })) }), 'r')
    expect((await v('success')).status).toBe('succeeded')
    expect((await v('abandoned')).status).toBe('failed')
    expect((await v('ongoing')).status).toBe('pending')
  })
})

describe('manual transfer driver', () => {
  it('returns bank instructions with our reference, or fails when details are missing', async () => {
    const r = await manualTransferDriver.createCheckout(ctx({ config: { bank_name: 'GTB', account_name: 'Kena Ltd', account_number: '0123' } }), {
      reference: 'ogd_b_1', sessionReference: 'ogd_b', method: 'bank_transfer', amount: 15000, currency: 'NGN', email: 'e', plan: { id: 'starter', name: 'S' }, interval: 'monthly', callbackUrl: 'u',
    })
    expect(r).toMatchObject({ kind: 'instructions', instructions: { bankName: 'GTB', accountNumber: '0123', amount: '15000.00', reference: 'ogd_b' } })
    await expect(manualTransferDriver.createCheckout(ctx(), { reference: 'r' } as never)).rejects.toThrow(/missing/)
  })
})

// ---------------------------------------------------------------- executor (in-memory database stand-in)
function fakeDb(opts: { route: unknown[]; instances: Record<string, { kind: string; config?: Record<string, unknown>; secrets?: string | null }>; coupon?: unknown }) {
  const tables: Record<string, Record<string, unknown>[]> = { checkout_sessions: [], payment_provider_plans: [] }
  const reports: { id: string; ok: boolean }[] = []
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []
  const query = (table: string) => {
    const filters: [string, unknown][] = []
    let patch: Record<string, unknown> | null = null
    let inserted: Record<string, unknown> | null = null
    const rows = () => (tables[table] ??= []).filter((r) => filters.every(([k, v]) => r[k] === v))
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters.push([k, v]); if (patch) { rows().forEach((r) => Object.assign(r, patch)) } return q },
      match: (m: Record<string, unknown>) => { Object.entries(m).forEach((e) => filters.push(e)); return q },
      maybeSingle: async () => ({ data: table === 'plans' ? { id: 'starter', name: 'Starter' } : rows()[0] ?? null, error: null }),
      single: async () => ({ data: inserted, error: null }),
      insert: (row: Record<string, unknown>) => { inserted = { id: `row${(tables[table] ??= []).length + 1}`, ...row }; tables[table]!.push(inserted); return q },
      update: (p: Record<string, unknown>) => { patch = p; return q },
    }
    return q
  }
  const db = {
    from: query,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      if (fn === 'payment_route') return { data: opts.route, error: null }
      if (fn === 'payment_quote') return { data: { amount: args.p_currency === 'NGN' ? 15000 : 12, currency: args.p_currency, baseAmount: 15000, baseCurrency: 'NGN' }, error: null }
      if (fn === 'payment_instance_secrets') { const i = opts.instances[args.p_id as string]; return { data: i ? { id: args.p_id, mode: 'test', config: i.config ?? {}, secrets: i.secrets ?? null, kind: i.kind } : null, error: null } }
      if (fn === 'payment_instance_public') { const i = opts.instances[args.p_id as string]; return { data: i ? { id: args.p_id, kind: i.kind, config: i.config ?? {} } : null, error: null } }
      if (fn === 'coupon_apply') return { data: opts.coupon ?? { ok: false, reason: 'not_found' }, error: null }
      if (fn === 'payment_instance_report') { reports.push({ id: args.p_id as string, ok: args.p_ok as boolean }); return { data: null, error: null } }
      return { data: { status: 'settled', accountId: 'acc' }, error: null }
    },
  }
  return { db: db as unknown as SupabaseClient, tables, reports, rpcCalls }
}

const deps = (f: Deps['fetch'], timeoutMs = 1000): Deps => ({ fetch: f, now: Date.now, timeoutMs, random: () => 'abc' })
const input = { accountId: 'acc', userId: 'u', email: 'a@x.ng', planId: 'starter', interval: 'monthly' as const, method: 'checkout_link' as const, country: 'NG', currency: 'NGN', mode: 'test' as const, appUrl: 'https://ogadesk.com/' }
const entry = (id: string, kind: string, reason: string | null = null, chargeCurrency = 'NGN') => ({ id, kind, name: id, mode: 'test', priority: 1, chargeCurrency, reason })

describe('startCheckout failover', () => {
  it('skips excluded instances, fails over from a broken one and records health', async () => {
    const secrets = await encryptPlatformSecret(JSON.stringify({ secret_key: 'sk_test_abc' }), KEY)
    vi.stubEnv('PLATFORM_SECRETS_KEY', KEY)
    const f = vi.fn()
      .mockResolvedValueOnce(json(500, { status: false, message: 'down' }))
      .mockResolvedValueOnce(json(200, { status: true, data: { authorization_url: 'https://pay/2', reference: 'ogd_abc_2' } }))
    const fx = fakeDb({ route: [entry('off', 'paystack', 'country'), entry('p1', 'paystack'), entry('p2', 'paystack')], instances: { p1: { kind: 'paystack', secrets }, p2: { kind: 'paystack', secrets } } })
    const r = await startCheckout(fx.db, input, deps(f))
    expect(r).toMatchObject({ ok: true, reference: 'ogd_abc', result: { kind: 'redirect', url: 'https://pay/2' } })
    expect(r.attempts.map((a) => [a.instanceId, a.ok])).toEqual([['p1', false], ['p2', true]])
    expect(fx.reports).toEqual([{ id: 'p1', ok: false }, { id: 'p2', ok: true }])
    expect(fx.tables.checkout_sessions![0]).toMatchObject({ status: 'redirected', instance_id: 'p2', checkout_url: 'https://pay/2', currency: 'NGN', amount: 15000 })
    expect(JSON.parse(f.mock.calls[1]![1].body).callback_url).toBe('https://ogadesk.com/settings/billing/return/ogd_abc')
    vi.unstubAllEnvs()
  })

  it('reports no_provider when nothing is eligible, and all_failed when every instance fails (also on timeout)', async () => {
    const none = fakeDb({ route: [entry('a', 'paystack', 'disabled')], instances: {} })
    expect(await startCheckout(none.db, input, deps(vi.fn()))).toMatchObject({ ok: false, error: 'no_provider' })
    const hang = vi.fn(() => new Promise<Response>(() => {}))
    const fx = fakeDb({ route: [entry('a', 'paystack'), entry('b', 'unknown_kind')], instances: { a: { kind: 'paystack', secrets: null } } })
    const r = await startCheckout(fx.db, input, deps(hang, 20))
    expect(r).toMatchObject({ ok: false, error: 'all_failed' })
    expect(r.attempts.map((a) => a.error)).toEqual([expect.stringMatching(/secret key|Timed out/), 'No driver for unknown_kind'])
    expect(fx.tables.checkout_sessions![0]).toMatchObject({ status: 'failed', failure_reason: 'all_failed' })
  })

  it('a bank transfer returns instructions and waits for the admin', async () => {
    const fx = fakeDb({ route: [entry('m', 'manual_transfer')], instances: { m: { kind: 'manual_transfer', config: { bank_name: 'GTB', account_name: 'K', account_number: '1' } } } })
    const r = await startCheckout(fx.db, { ...input, method: 'bank_transfer' }, deps(vi.fn()))
    expect(r).toMatchObject({ ok: true, result: { kind: 'instructions' } })
    expect(fx.tables.checkout_sessions![0]).toMatchObject({ status: 'awaiting_transfer', provider: 'manual_transfer' })
  })

  it('creates the provider plan once for subscriptions and reuses it', async () => {
    vi.stubEnv('PLATFORM_SECRETS_KEY', KEY)
    const secrets = await encryptPlatformSecret(JSON.stringify({ secret_key: 'sk_test_abc' }), KEY)
    const f = vi.fn(async (url: string, ...rest: [RequestInit?]) => rest.length >= 0 && url.endsWith('/plan') ? json(200, { status: true, data: { plan_code: 'PLN_9' } }) : json(200, { status: true, data: { authorization_url: 'u', reference: 'r' } }))
    const fx = fakeDb({ route: [entry('p', 'paystack')], instances: { p: { kind: 'paystack', secrets } } })
    await startCheckout(fx.db, { ...input, method: 'subscription' }, deps(f as never))
    await startCheckout(fx.db, { ...input, method: 'subscription' }, deps(f as never))
    expect(f.mock.calls.filter(([u]) => String(u).endsWith('/plan'))).toHaveLength(1)
    expect(JSON.parse(String(f.mock.calls.at(-1)![1]!.body)).plan).toBe('PLN_9')
    vi.unstubAllEnvs()
  })
})

describe('startCheckout: provider fee and coupons', () => {
  const paystackFees = { fee_payer: 'customer', fee_percent: '1.5', fee_flat: '100', fee_cap: '2000', fee_flat_waived_below: '2500' }
  const ok = (url = 'https://pay/1') => vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => json(200, { status: true, data: { authorization_url: url, reference: 'r' } }))

  it('adds the fee the customer pays to the amount sent to the provider and records the breakdown', async () => {
    vi.stubEnv('PLATFORM_SECRETS_KEY', KEY)
    const secrets = await encryptPlatformSecret(JSON.stringify({ secret_key: 'sk_test_abc' }), KEY)
    const f = ok()
    const fx = fakeDb({ route: [entry('p', 'paystack')], instances: { p: { kind: 'paystack', secrets, config: paystackFees } } })
    const r = await startCheckout(fx.db, input, deps(f))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const total = r.breakdown.total
    expect(r.breakdown).toMatchObject({ subtotal: 15000, discount: 0, feePayer: 'customer' })
    expect(r.breakdown.fee).toBeGreaterThan(300)
    expect(total).toBeCloseTo(15000 + r.breakdown.fee, 2)
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body)).amount).toBe(Math.round(total * 100))
    expect(fx.tables.checkout_sessions![0]).toMatchObject({ amount: total, list_amount: 15000, discount_amount: 0, fee_amount: r.breakdown.fee, fee_payer: 'customer', coupon_id: null })
    vi.unstubAllEnvs()
  })

  it('charges the plain price when the business pays the fee, and still records the expected cost', async () => {
    vi.stubEnv('PLATFORM_SECRETS_KEY', KEY)
    const secrets = await encryptPlatformSecret(JSON.stringify({ secret_key: 'sk_test_abc' }), KEY)
    const fx = fakeDb({ route: [entry('p', 'paystack')], instances: { p: { kind: 'paystack', secrets, config: { ...paystackFees, fee_payer: 'business' } } } })
    const r = await startCheckout(fx.db, input, deps(ok()))
    expect(r).toMatchObject({ ok: true, amount: 15000, breakdown: { fee: 0, feePayer: 'business', total: 15000 } })
    expect(fx.tables.checkout_sessions![0]).toMatchObject({ amount: 15000, fee_payer: 'business', fee_amount: 100 + 0.015 * 15000 })
    vi.unstubAllEnvs()
  })

  it('applies a coupon before the fee (the fee is on what is actually paid)', async () => {
    vi.stubEnv('PLATFORM_SECRETS_KEY', KEY)
    const secrets = await encryptPlatformSecret(JSON.stringify({ secret_key: 'sk_test_abc' }), KEY)
    const fx = fakeDb({
      route: [entry('p', 'paystack')], instances: { p: { kind: 'paystack', secrets, config: paystackFees } },
      coupon: { ok: true, couponId: 'c1', code: 'SAVE20', duration: 'once', discount: 3000 },
    })
    const r = await startCheckout(fx.db, { ...input, couponCode: 'save20' }, deps(ok()))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.breakdown).toMatchObject({ subtotal: 15000, discount: 3000, couponCode: 'SAVE20' })
    expect(r.breakdown.total).toBeCloseTo(12000 + r.breakdown.fee, 2)
    expect(fx.tables.checkout_sessions![0]).toMatchObject({ coupon_id: 'c1', discount_amount: 3000, list_amount: 15000 })
    expect(fx.rpcCalls.find((c) => c.fn === 'coupon_apply')!.args).toMatchObject({ p_code: 'save20', p_account: 'acc', p_plan: 'starter', p_subtotal: 15000 })
    vi.unstubAllEnvs()
  })

  it('rejects an unusable coupon before any checkout session exists', async () => {
    const fx = fakeDb({ route: [entry('p', 'paystack')], instances: { p: { kind: 'paystack' } }, coupon: { ok: false, reason: 'expired' } })
    const r = await startCheckout(fx.db, { ...input, couponCode: 'OLD' }, deps(vi.fn()))
    expect(r).toMatchObject({ ok: false, error: 'coupon_invalid', couponReason: 'expired' })
    expect(fx.tables.checkout_sessions).toHaveLength(0)
  })

  it('does not combine a first-payment-only coupon with an automatic subscription', async () => {
    const fx = fakeDb({ route: [entry('p', 'paystack')], instances: { p: { kind: 'paystack' } }, coupon: { ok: true, couponId: 'c1', code: 'ONCE', duration: 'once', discount: 1000 } })
    const r = await startCheckout(fx.db, { ...input, method: 'subscription', couponCode: 'ONCE' }, deps(vi.fn()))
    expect(r).toMatchObject({ ok: false, error: 'coupon_not_recurring' })
    expect(fx.tables.checkout_sessions).toHaveLength(0)
  })

  it('a coupon that lasts is allowed on a subscription and the provider plan is created at the discounted total', async () => {
    vi.stubEnv('PLATFORM_SECRETS_KEY', KEY)
    const secrets = await encryptPlatformSecret(JSON.stringify({ secret_key: 'sk_test_abc' }), KEY)
    const f = vi.fn(async (url: RequestInfo | URL, _i?: RequestInit) => String(url).endsWith('/plan') ? json(200, { status: true, data: { plan_code: 'PLN_D' } }) : json(200, { status: true, data: { authorization_url: 'u', reference: 'r' } }))
    const fx = fakeDb({ route: [entry('p', 'paystack')], instances: { p: { kind: 'paystack', secrets } }, coupon: { ok: true, couponId: 'c1', code: 'FOREVER', duration: 'forever', discount: 5000 } })
    const r = await startCheckout(fx.db, { ...input, method: 'subscription', couponCode: 'FOREVER' }, deps(f as never))
    expect(r).toMatchObject({ ok: true, amount: 10000 })
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body)).amount).toBe(1_000_000)
    expect(fx.tables.payment_provider_plans![0]).toMatchObject({ amount: 10000, provider_plan_id: 'PLN_D' })
    vi.unstubAllEnvs()
  })

  it('a coupon that takes off everything activates the plan without calling a provider', async () => {
    const f = vi.fn()
    const fx = fakeDb({ route: [entry('p', 'paystack')], instances: { p: { kind: 'paystack', config: paystackFees } }, coupon: { ok: true, couponId: 'c1', code: 'FREE', duration: 'once', discount: 15000 } })
    const r = await startCheckout(fx.db, { ...input, couponCode: 'FREE' }, deps(f))
    expect(r).toMatchObject({ ok: true, amount: 0, result: { kind: 'completed' }, breakdown: { total: 0, fee: 0, discount: 15000 } })
    expect(f).not.toHaveBeenCalled()
    expect(fx.tables.checkout_sessions![0]).toMatchObject({ provider: 'coupon', amount: 0, method: 'checkout_link', coupon_id: 'c1' })
    expect(fx.rpcCalls.find((c) => c.fn === 'payment_settle')!.args).toMatchObject({ p_amount: 0, p_provider_reference: 'ogd_abc_coupon' })
  })
})

describe('applyEvent', () => {
  it('settles our own checkout, sends renewals to payment_renew, stops auto-renew on failure', async () => {
    const fx = fakeDb({ route: [], instances: {} })
    fx.tables.checkout_sessions!.push({ id: 's1', reference: 'ogd_a' })
    await applyEvent(fx.db, 'i1', 'paystack', { type: 'payment.succeeded', providerReference: 'ogd_a_1', amount: 15000, currency: 'NGN', sessionReference: 'ogd_a', customerId: 'CUS' })
    await applyEvent(fx.db, 'i1', 'paystack', { type: 'payment.succeeded', providerReference: 'T2', amount: 15000, currency: 'NGN', subscriptionId: 'SUB' })
    await applyEvent(fx.db, 'i1', 'paystack', { type: 'subscription.payment_failed', subscriptionId: 'SUB' })
    expect(fx.rpcCalls.map((c) => c.fn)).toEqual(['payment_settle', 'payment_renew', 'payment_subscription_stopped'])
    expect(fx.rpcCalls[0]!.args).toMatchObject({ p_session: 's1', p_provider_reference: 'ogd_a_1', p_customer_id: 'CUS' })
  })
})

describe('cancelRenewal', () => {
  function subDb(sub: Record<string, unknown> | null) {
    const updates: Record<string, unknown>[] = []
    const db = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: sub, error: null }) }) }),
        update: (p: Record<string, unknown>) => ({ eq: async () => { updates.push(p); return { error: null } } }),
      }),
      rpc: async (fn: string) => fn === 'payment_instance_secrets'
        ? { data: { id: 'i1', kind: 'paystack', mode: 'test', config: {}, secrets: await encryptPlatformSecret(JSON.stringify({ secret_key: 'sk_test_abc' }), KEY) }, error: null }
        : { data: null, error: null },
    }
    return { db: db as unknown as SupabaseClient, updates }
  }
  const card = { plan_id: 'pro', status: 'active', auto_renew: true, provider: 'paystack', provider_subscription_id: 'SUB_1', payment_instance_id: 'i1', provider_meta: { emailToken: 'tok' }, current_period_end: '2026-12-31T00:00:00Z' }

  it('disables a card subscription at Paystack, then stops renewal', async () => {
    vi.stubEnv('PLATFORM_SECRETS_KEY', KEY)
    const f = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => json(200, { status: true, data: {} }))
    const d = subDb(card)
    const out = await cancelRenewal(d.db, 'acc', { fetch: f as never })
    expect(out).toEqual({ status: 'stopped', periodEnd: '2026-12-31T00:00:00Z' })
    expect(String(f.mock.calls[0]![0])).toBe('https://api.paystack.co/subscription/disable')
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toEqual({ code: 'SUB_1', token: 'tok' })
    expect(d.updates).toEqual([{ auto_renew: false }])
    vi.unstubAllEnvs()
  })

  it('looks up the token when the webhook did not provide it', async () => {
    vi.stubEnv('PLATFORM_SECRETS_KEY', KEY)
    const f = vi.fn(async (u: RequestInfo | URL, _i?: RequestInit) => String(u).includes('/subscription/SUB_1') ? json(200, { status: true, data: { email_token: 'looked-up' } }) : json(200, { status: true, data: {} }))
    await cancelRenewal(subDb({ ...card, provider_meta: {} }).db, 'acc', { fetch: f as never })
    expect(JSON.parse(String(f.mock.calls[1]![1]!.body))).toEqual({ code: 'SUB_1', token: 'looked-up' })
    vi.unstubAllEnvs()
  })

  it('changes nothing when the provider refuses (so the customer is never told it stopped while still being charged)', async () => {
    vi.stubEnv('PLATFORM_SECRETS_KEY', KEY)
    const f = vi.fn(async () => json(400, { status: false, message: 'Subscription not found' }))
    const d = subDb(card)
    const out = await cancelRenewal(d.db, 'acc', { fetch: f as never })
    expect(out.status).toBe('failed')
    expect(d.updates).toEqual([])
    vi.unstubAllEnvs()
  })

  it('only switches auto-renew off when nothing is at the provider; nothing to stop on Free or a trial', async () => {
    const transfer = subDb({ ...card, provider: 'manual_transfer', provider_subscription_id: null, payment_instance_id: 'm1' })
    expect((await cancelRenewal(transfer.db, 'acc', { fetch: vi.fn() as never })).status).toBe('stopped')
    expect(transfer.updates).toEqual([{ auto_renew: false }])
    expect((await cancelRenewal(subDb({ ...card, plan_id: 'free' }).db, 'acc')).status).toBe('nothing_to_stop')
    expect((await cancelRenewal(subDb({ ...card, status: 'trialing' }).db, 'acc')).status).toBe('nothing_to_stop')
    expect((await cancelRenewal(subDb(null).db, 'acc')).status).toBe('nothing_to_stop')
  })
})
