import { PaymentError, type CheckoutInput, type DriverContext, type PaymentDriver, type PaymentEvent, type VerifyResult } from '../types'

// Paystack: https://paystack.com/docs/api/ . Amounts are sent in the currency subunit (x100, also for XOF).
const API = 'https://api.paystack.co'
const INTERVAL: Record<CheckoutInput['interval'], string> = { monthly: 'monthly', quarterly: 'quarterly', annual: 'annually' }

const toSub = (amount: number) => Math.round(amount * 100)

async function call<T>(ctx: DriverContext, path: string, init: RequestInit = {}): Promise<T> {
  const key = ctx.secrets.secret_key
  if (!key) throw new PaymentError('Paystack secret key is not configured', false, 401)
  let res: Response
  try {
    res = await ctx.fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers ?? {}) } })
  } catch (e) {
    throw new PaymentError(`Paystack unreachable: ${e instanceof Error ? e.message : 'network error'}`, true)
  }
  const body = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null
  if (!res.ok || !body?.status) {
    const msg = body?.message ?? `HTTP ${res.status}`
    throw new PaymentError(`Paystack: ${msg}`, res.status >= 500 || res.status === 429, res.status)
  }
  return body.data as T
}

async function hmacSha512Hex(secret: string, body: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body)))
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

type PaystackData = {
  reference?: string; amount?: number; currency?: string; status?: string
  customer?: { customer_code?: string; email?: string }
  plan?: { plan_code?: string } | string | null
  metadata?: { checkout_reference?: string } | string | null
  subscription_code?: string; email_token?: string
  subscription?: { subscription_code?: string }
}

const planCode = (d: PaystackData) => (typeof d.plan === 'object' && d.plan ? d.plan.plan_code : typeof d.plan === 'string' && d.plan ? d.plan : undefined)
const sessionRef = (d: PaystackData) => (typeof d.metadata === 'object' && d.metadata ? d.metadata.checkout_reference : undefined)

export const paystackDriver: PaymentDriver = {
  kind: 'paystack',

  async createCheckout(ctx, input) {
    const data = await call<{ authorization_url: string; reference: string }>(ctx, '/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: input.email,
        amount: toSub(input.amount),
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
        ...(input.method === 'subscription' && input.providerPlanId ? { plan: input.providerPlanId } : {}),
        metadata: { checkout_reference: input.sessionReference, plan_id: input.plan.id, interval: input.interval },
      }),
    })
    return { kind: 'redirect', url: data.authorization_url, providerReference: data.reference }
  },

  async ensurePlan(ctx, plan) {
    const data = await call<{ plan_code: string }>(ctx, '/plan', {
      method: 'POST',
      body: JSON.stringify({ name: `OgaDesk ${plan.name} (${plan.interval}, ${plan.currency} ${plan.amount})`, interval: INTERVAL[plan.interval], amount: toSub(plan.amount), currency: plan.currency }),
    })
    return data.plan_code
  },

  async verify(ctx, providerReference): Promise<VerifyResult> {
    const d = await call<PaystackData>(ctx, `/transaction/verify/${encodeURIComponent(providerReference)}`)
    const status = d.status === 'success' ? 'succeeded' : d.status === 'failed' || d.status === 'abandoned' || d.status === 'reversed' ? 'failed' : 'pending'
    return { status, amount: d.amount != null ? d.amount / 100 : undefined, currency: d.currency, customerId: d.customer?.customer_code, raw: d }
  },

  async parseWebhook(ctx, rawBody, headers): Promise<PaymentEvent> {
    const sig = headers.get('x-paystack-signature') ?? ''
    const secret = ctx.secrets.secret_key
    if (!secret || !sig || !safeEqual(await hmacSha512Hex(secret, rawBody), sig.toLowerCase())) throw new PaymentError('Invalid Paystack signature', false, 401)
    const { event, data } = JSON.parse(rawBody) as { event: string; data: PaystackData }
    switch (event) {
      case 'charge.success':
        return {
          type: 'payment.succeeded', providerReference: data.reference ?? '', amount: (data.amount ?? 0) / 100, currency: data.currency ?? '',
          customerId: data.customer?.customer_code, planId: planCode(data), sessionReference: sessionRef(data), subscriptionId: data.subscription?.subscription_code,
        }
      case 'subscription.create':
        return {
          type: 'subscription.created', subscriptionId: data.subscription_code ?? '', customerId: data.customer?.customer_code, planId: planCode(data),
          meta: data.email_token ? { emailToken: data.email_token } : {},
        }
      case 'invoice.payment_failed':
        return { type: 'subscription.payment_failed', subscriptionId: data.subscription?.subscription_code ?? data.subscription_code ?? '' }
      case 'subscription.disable':
      case 'subscription.not_renew':
        return { type: 'subscription.canceled', subscriptionId: data.subscription_code ?? '' }
      default:
        return { type: 'ignored', event }
    }
  },

  async cancelSubscription(ctx, sub) {
    // Paystack disables a subscription with its code + email token. The token arrives with the
    // subscription.create webhook (kept in provider_meta); otherwise read it from the subscription.
    let token = typeof sub.meta.emailToken === 'string' ? sub.meta.emailToken : ''
    if (!token) token = (await call<{ email_token?: string }>(ctx, `/subscription/${encodeURIComponent(sub.subscriptionId)}`)).email_token ?? ''
    if (!token) throw new PaymentError('Paystack did not return the subscription token', false)
    await call(ctx, '/subscription/disable', { method: 'POST', body: JSON.stringify({ code: sub.subscriptionId, token }) })
  },

  async testConnection(ctx) {
    try {
      await call(ctx, '/balance')
      return { ok: true, detail: 'The secret key works.' }
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : 'Failed' }
    }
  },
}
