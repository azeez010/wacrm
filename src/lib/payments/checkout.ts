import type { SupabaseClient } from '@supabase/supabase-js'

import { markReferralPaid } from '@/lib/partner/crm-sync'
import { computeFee, homeCurrency, type PaymentMethod } from './catalogue'
import { paymentDriver } from './registry'
import { decryptSecretsObject } from './secrets'
import { PaymentError, type CheckoutResult, type DriverContext, type PaymentEvent } from './types'

// ============================================================
// Checkout with failover. The route (which instances, in what order, and why others are skipped)
// comes from public.payment_route, the same function the admin simulator shows. Each eligible
// instance is tried in order; any failure is recorded and the next instance is tried. Health is
// reported back so an instance that keeps failing cools down and is skipped automatically.
// ============================================================

export type RouteEntry = { id: string; kind: string; name: string; mode: 'test' | 'live'; priority: number; chargeCurrency: string | null; reason: string | null }
export type Attempt = { instanceId: string; kind: string; name: string; ok: boolean; error?: string; ms: number; currency?: string; amount?: number }
type Quote = { amount: number; currency: string; baseAmount: number; baseCurrency: string }
type CouponResult = { ok: true; couponId: string; code: string; duration: 'once' | 'forever'; discount: number } | { ok: false; reason: string }

/** What the customer is charged, line by line. `total` is what is sent to the provider. */
export interface PriceBreakdown {
  subtotal: number
  discount: number
  /** The fee added to the customer's total (0 when the business pays it). */
  fee: number
  feePayer: 'customer' | 'business'
  total: number
  currency: string
  couponCode: string | null
}

export interface StartCheckoutInput {
  accountId: string
  userId: string
  email: string
  planId: string
  interval: 'monthly' | 'quarterly' | 'annual'
  method: PaymentMethod
  country: string | null
  currency: string
  mode: 'test' | 'live'
  appUrl: string
  transferExpiryDays?: number
  /** An admin-created coupon code the customer typed; re-validated here. */
  couponCode?: string
}

/** `completed`: a 100%-off coupon, so no provider is involved and the plan is already active. */
export type StartCheckoutResult =
  | { ok: true; reference: string; result: CheckoutResult | { kind: 'completed' }; attempts: Attempt[]; amount: number; currency: string; breakdown: PriceBreakdown }
  | { ok: false; error: 'no_provider' | 'unknown_plan' | 'all_failed' | 'coupon_invalid' | 'coupon_not_recurring'; couponReason?: string; reference?: string; attempts: Attempt[] }

export interface Deps {
  fetch: typeof fetch
  now: () => number
  timeoutMs: number
  random: () => string
}
const defaultDeps: Deps = {
  fetch: (...a) => fetch(...a),
  now: Date.now,
  timeoutMs: 15_000,
  random: () => crypto.randomUUID().replace(/-/g, '').slice(0, 16),
}

const rpc = async <T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data as T
}

export async function getRoute(db: SupabaseClient, country: string | null, currency: string, method: PaymentMethod, mode: 'test' | 'live' | null): Promise<RouteEntry[]> {
  return (await rpc<RouteEntry[]>(db, 'payment_route', { p_country: country ?? '', p_currency: currency, p_method: method, p_mode: mode })) ?? []
}

export async function driverContext(db: SupabaseClient, instanceId: string, deps: Pick<Deps, 'fetch'> = defaultDeps): Promise<{ kind: string; ctx: DriverContext }> {
  const row = await rpc<{ id: string; kind: string; mode: 'test' | 'live'; config: Record<string, unknown>; secrets: string | null } | null>(db, 'payment_instance_secrets', { p_id: instanceId })
  if (!row) throw new PaymentError('Payment instance not found', false, 404)
  return { kind: row.kind, ctx: { instanceId, mode: row.mode, config: row.config ?? {}, secrets: await decryptSecretsObject(row.secrets), fetch: deps.fetch } }
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new PaymentError(`Timed out after ${ms} ms`, true)), ms))])

async function report(db: SupabaseClient, instanceId: string, ok: boolean, error?: string) {
  try {
    await db.rpc('payment_instance_report', { p_id: instanceId, p_ok: ok, p_error: error ?? null })
  } catch {
    /* health bookkeeping must never break a checkout */
  }
}

async function providerPlanId(db: SupabaseClient, instanceId: string, ctx: DriverContext, kind: string, plan: { id: string; name: string }, interval: StartCheckoutInput['interval'], amount: number, currency: string): Promise<string> {
  const { data } = await db.from('payment_provider_plans').select('provider_plan_id')
    .match({ instance_id: instanceId, plan_id: plan.id, billing_interval: interval, currency, amount }).maybeSingle()
  if (data?.provider_plan_id) return data.provider_plan_id as string
  const driver = paymentDriver(kind)
  if (!driver?.ensurePlan) throw new PaymentError(`${kind} does not support subscriptions`, false)
  const id = await driver.ensurePlan(ctx, { ...plan, interval, amount, currency })
  await db.from('payment_provider_plans').insert({ instance_id: instanceId, plan_id: plan.id, billing_interval: interval, currency, amount, provider_plan_id: id })
  return id
}

/** Price for one instance: the plan quote in its charge currency, minus the coupon, plus the provider fee when the customer pays it. */
export async function priceFor(
  db: SupabaseClient, plan: { id: string }, input: Pick<StartCheckoutInput, 'accountId' | 'interval' | 'couponCode'>,
  inst: { kind: string; chargeCurrency: string | null }, config: Record<string, unknown>,
): Promise<{ quote: Quote; breakdown: PriceBreakdown; couponId: string | null; couponDuration: 'once' | 'forever' | null; providerFee: number } | { error: 'no_price' | 'coupon_invalid'; couponReason?: string }> {
  const quote = await rpc<Quote | null>(db, 'payment_quote', { p_plan: plan.id, p_interval: input.interval, p_currency: inst.chargeCurrency })
  if (!quote) return { error: 'no_price' }
  const subtotal = Number(quote.amount)
  let discount = 0
  let couponId: string | null = null
  let couponDuration: 'once' | 'forever' | null = null
  let couponCode: string | null = null
  if (input.couponCode?.trim()) {
    const c = await rpc<CouponResult>(db, 'coupon_apply', { p_code: input.couponCode, p_account: input.accountId, p_plan: plan.id, p_interval: input.interval, p_subtotal: subtotal, p_currency: quote.currency })
    if (!c.ok) return { error: 'coupon_invalid', couponReason: c.reason }
    discount = Number(c.discount)
    couponId = c.couponId
    couponDuration = c.duration
    couponCode = c.code
  }
  const discounted = Math.max(0, Math.round((subtotal - discount) * 100) / 100)
  const fee = computeFee(config, homeCurrency(inst.kind, config), quote.currency, discounted)
  return {
    quote, couponId, couponDuration, providerFee: fee.providerFee,
    breakdown: { subtotal, discount, fee: fee.fee, feePayer: fee.payer, total: fee.total, currency: quote.currency, couponCode },
  }
}

export async function startCheckout(db: SupabaseClient, input: StartCheckoutInput, deps: Deps = defaultDeps): Promise<StartCheckoutResult> {
  const { data: plan } = await db.from('plans').select('id, name').eq('id', input.planId).eq('is_active', true).maybeSingle()
  if (!plan || plan.id === 'free') return { ok: false, error: 'unknown_plan', attempts: [] }

  const route = await getRoute(db, input.country, input.currency, input.method, input.mode)
  const eligible = route.filter((r) => !r.reason && r.chargeCurrency)
  if (eligible.length === 0) return { ok: false, error: 'no_provider', attempts: [] }

  // A bad or unusable coupon is the customer's problem, not an instance failure: say so before any session exists.
  if (input.couponCode?.trim()) {
    const first = eligible[0]!
    const pub = await rpc<{ config: Record<string, unknown> } | null>(db, 'payment_instance_public', { p_id: first.id })
    const p = await priceFor(db, plan as { id: string }, input, first, pub?.config ?? {})
    if ('error' in p) return p.error === 'coupon_invalid' ? { ok: false, error: 'coupon_invalid', couponReason: p.couponReason, attempts: [] } : { ok: false, error: 'no_provider', attempts: [] }
    // A "once" coupon discounts one payment; a subscription would renew at full price, so it is one-off only.
    if (p.couponDuration === 'once' && input.method === 'subscription') return { ok: false, error: 'coupon_not_recurring', attempts: [] }
  }

  const reference = `ogd_${deps.random()}`
  const expires = new Date(deps.now() + (input.method === 'bank_transfer' ? (input.transferExpiryDays ?? 7) * 86_400_000 : 86_400_000)).toISOString()
  const { data: session, error } = await db.from('checkout_sessions').insert({
    reference, account_id: input.accountId, user_id: input.userId, plan_id: plan.id, billing_interval: input.interval, method: input.method,
    mode: input.mode, country: input.country, status: 'pending', expires_at: expires,
  }).select('id').single()
  if (error || !session) throw new Error(`checkout_sessions insert: ${error?.message}`)

  const attempts: Attempt[] = []
  for (const [i, inst] of eligible.entries()) {
    const started = deps.now()
    const attempt: Attempt = { instanceId: inst.id, kind: inst.kind, name: inst.name, ok: false, ms: 0 }
    try {
      const driver = paymentDriver(inst.kind)
      if (!driver) throw new PaymentError(`No driver for ${inst.kind}`, false)
      const { ctx } = await driverContext(db, inst.id, deps)
      const priced = await priceFor(db, plan as { id: string }, input, inst, ctx.config)
      if ('error' in priced) throw new PaymentError(priced.error === 'coupon_invalid' ? `Coupon not usable in ${inst.chargeCurrency}` : `No price or exchange rate for ${inst.chargeCurrency}`, false)
      const { quote, breakdown } = priced
      attempt.amount = breakdown.total
      attempt.currency = quote.currency
      const breakdownColumns = {
        coupon_id: priced.couponId, list_amount: breakdown.subtotal, discount_amount: breakdown.discount,
        fee_amount: breakdown.feePayer === 'customer' ? breakdown.fee : priced.providerFee, fee_payer: breakdown.feePayer,
      }

      // A coupon that takes the whole price off: nothing to charge, so activate the plan directly.
      if (breakdown.total === 0) {
        attempt.ok = true
        attempt.ms = deps.now() - started
        attempts.push(attempt)
        await db.from('checkout_sessions').update({
          provider: 'coupon', instance_id: null, method: 'checkout_link', currency: quote.currency, amount: 0, base_amount: quote.baseAmount, base_currency: quote.baseCurrency,
          ...breakdownColumns, status: 'pending', attempts,
        }).eq('id', session.id)
        await settle(db, session.id as string, `${reference}_coupon`, 0, quote.currency)
        return { ok: true, reference, result: { kind: 'completed' }, attempts, amount: 0, currency: quote.currency, breakdown }
      }

      const providerPlan = input.method === 'subscription'
        ? await withTimeout(providerPlanId(db, inst.id, ctx, inst.kind, { id: plan.id as string, name: plan.name as string }, input.interval, breakdown.total, quote.currency), deps.timeoutMs)
        : undefined
      const result = await withTimeout(driver.createCheckout(ctx, {
        reference: `${reference}_${i + 1}`, sessionReference: reference, method: input.method, amount: breakdown.total, currency: quote.currency,
        email: input.email, plan: { id: plan.id as string, name: plan.name as string }, interval: input.interval,
        callbackUrl: `${input.appUrl.replace(/\/+$/, '')}/settings/billing/return/${reference}`, providerPlanId: providerPlan,
      }), deps.timeoutMs)
      attempt.ok = true
      attempt.ms = deps.now() - started
      attempts.push(attempt)
      await report(db, inst.id, true)
      await db.from('checkout_sessions').update({
        instance_id: inst.id, provider: inst.kind, currency: quote.currency, amount: breakdown.total, base_amount: quote.baseAmount, base_currency: quote.baseCurrency,
        ...breakdownColumns,
        status: result.kind === 'redirect' ? 'redirected' : 'awaiting_transfer',
        checkout_url: result.kind === 'redirect' ? result.url : null,
        instructions: result.kind === 'instructions' ? result.instructions : null,
        attempts,
      }).eq('id', session.id)
      return { ok: true, reference, result, attempts, amount: breakdown.total, currency: quote.currency, breakdown }
    } catch (e) {
      attempt.error = e instanceof Error ? e.message : 'Failed'
      attempt.ms = deps.now() - started
      attempts.push(attempt)
      await report(db, inst.id, false, attempt.error)
    }
  }
  await db.from('checkout_sessions').update({ status: 'failed', attempts, failure_reason: 'all_failed', completed_at: new Date(deps.now()).toISOString() }).eq('id', session.id)
  return { ok: false, error: 'all_failed', reference, attempts }
}

export type SettleOutcome = { status: 'settled' | 'duplicate' | 'not_found' | 'ignored' | 'pending' | 'failed'; accountId?: string; planId?: string }

/** Turns a confirmed payment into a plan (idempotent), and tells the partner CRM once. */
export async function settle(db: SupabaseClient, sessionId: string, providerReference: string, amount: number | null, currency: string | null, customerId?: string, subscriptionId?: string, meta: Record<string, string> = {}): Promise<SettleOutcome> {
  const out = await rpc<SettleOutcome>(db, 'payment_settle', {
    p_session: sessionId, p_provider_reference: providerReference, p_amount: amount, p_currency: currency,
    p_customer_id: customerId ?? null, p_subscription_id: subscriptionId ?? null, p_meta: meta,
  })
  if (out.status === 'settled' && out.accountId) await markReferralPaid(db, out.accountId)
  return out
}

/** The return page: asks the provider about a redirected checkout and settles it if paid. */
export async function verifyCheckout(db: SupabaseClient, reference: string, deps: Pick<Deps, 'fetch'> = defaultDeps): Promise<SettleOutcome & { sessionStatus: string }> {
  const { data: s } = await db.from('checkout_sessions').select('id, status, instance_id, attempts').eq('reference', reference).maybeSingle()
  if (!s) return { status: 'not_found', sessionStatus: 'missing' }
  if (s.status !== 'redirected' || !s.instance_id) return { status: 'ignored', sessionStatus: s.status as string }
  const { kind, ctx } = await driverContext(db, s.instance_id as string, deps)
  const driver = paymentDriver(kind)
  if (!driver?.verify) return { status: 'pending', sessionStatus: s.status as string }
  const attempts = (s.attempts as Attempt[]) ?? []
  const idx = attempts.findIndex((a) => a.ok)
  const providerRef = `${reference}_${idx + 1}`
  const v = await driver.verify(ctx, providerRef)
  if (v.status === 'succeeded') {
    const out = await settle(db, s.id as string, providerRef, v.amount ?? null, v.currency ?? null, v.customerId)
    return { ...out, sessionStatus: 'succeeded' }
  }
  if (v.status === 'failed') {
    await db.from('checkout_sessions').update({ status: 'failed', failure_reason: 'declined', completed_at: new Date().toISOString() }).eq('id', s.id)
    return { status: 'failed', sessionStatus: 'failed' }
  }
  return { status: 'pending', sessionStatus: s.status as string }
}

/** Applies a verified provider event. Unknown sessions/subscriptions are ignored (200), never retried. */
export async function applyEvent(db: SupabaseClient, instanceId: string, kind: string, ev: PaymentEvent): Promise<SettleOutcome> {
  switch (ev.type) {
    case 'payment.succeeded': {
      if (ev.sessionReference) {
        const { data: s } = await db.from('checkout_sessions').select('id').eq('reference', ev.sessionReference).maybeSingle()
        if (s) return settle(db, s.id as string, ev.providerReference, ev.amount, ev.currency, ev.customerId, ev.subscriptionId)
      }
      // No session of ours: a provider renewal of an existing subscription.
      const out = await rpc<SettleOutcome>(db, 'payment_renew', {
        p_instance: instanceId, p_provider: kind, p_provider_reference: ev.providerReference, p_amount: ev.amount, p_currency: ev.currency,
        p_subscription_id: ev.subscriptionId ?? null, p_customer_id: ev.customerId ?? null,
      })
      return out
    }
    case 'subscription.created': {
      if (!ev.customerId) return { status: 'ignored' }
      const { data } = await db.from('account_subscriptions').select('account_id, provider_meta')
        .eq('payment_instance_id', instanceId).eq('provider_customer_id', ev.customerId).maybeSingle()
      if (!data) return { status: 'not_found' }
      await db.from('account_subscriptions').update({
        provider_subscription_id: ev.subscriptionId, auto_renew: true,
        provider_meta: { ...((data.provider_meta as Record<string, unknown>) ?? {}), ...ev.meta },
      }).eq('account_id', data.account_id)
      return { status: 'settled', accountId: data.account_id as string }
    }
    case 'subscription.payment_failed':
    case 'subscription.canceled':
      if (!ev.subscriptionId) return { status: 'ignored' }
      await rpc(db, 'payment_subscription_stopped', { p_instance: instanceId, p_subscription_id: ev.subscriptionId, p_failed: ev.type === 'subscription.payment_failed' })
      return { status: 'settled' }
    default:
      return { status: 'ignored' }
  }
}

export type CancelOutcome = { status: 'stopped' | 'nothing_to_stop' | 'failed'; error?: string; periodEnd?: string | null }

/**
 * Stop the workspace's plan from renewing. The paid period runs out normally, then the daily sweep moves it to
 * Free. A provider subscription (card) is disabled at the provider first; if that fails nothing changes here, so
 * the customer is never told renewal stopped while the provider keeps charging. Bank-transfer / one-off plans have
 * nothing at the provider: only auto_renew is switched off.
 */
export async function cancelRenewal(db: SupabaseClient, accountId: string, deps: Pick<Deps, 'fetch'> = defaultDeps): Promise<CancelOutcome> {
  const { data: sub } = await db.from('account_subscriptions')
    .select('plan_id, status, auto_renew, provider, provider_subscription_id, payment_instance_id, provider_meta, current_period_end')
    .eq('account_id', accountId).maybeSingle()
  if (!sub || sub.plan_id === 'free' || sub.status === 'trialing') return { status: 'nothing_to_stop' }
  if (sub.provider_subscription_id && sub.payment_instance_id) {
    try {
      const { kind, ctx } = await driverContext(db, sub.payment_instance_id as string, deps)
      const driver = paymentDriver(kind)
      if (driver?.cancelSubscription) {
        await driver.cancelSubscription(ctx, { subscriptionId: sub.provider_subscription_id as string, meta: (sub.provider_meta as Record<string, unknown>) ?? {} })
      }
    } catch (e) {
      return { status: 'failed', error: e instanceof Error ? e.message : 'Could not stop the subscription at the payment provider' }
    }
  }
  if (sub.auto_renew === false && !sub.provider_subscription_id) return { status: 'nothing_to_stop', periodEnd: (sub.current_period_end as string | null) ?? null }
  await db.from('account_subscriptions').update({ auto_renew: false }).eq('account_id', accountId)
  return { status: 'stopped', periodEnd: (sub.current_period_end as string | null) ?? null }
}
