import type { PaymentMethod } from './catalogue'

/** Thrown by drivers. Any driver error makes the executor fail over to the next instance;
 *  `retryable` only describes the cause (network/5xx/timeout vs. bad key/bad request). */
export class PaymentError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number) {
    super(message)
    this.name = 'PaymentError'
  }
}

export interface DriverContext {
  instanceId: string
  mode: 'test' | 'live'
  config: Record<string, unknown>
  secrets: Record<string, string>
  /** Injectable for tests. */
  fetch: typeof fetch
}

export interface CheckoutInput {
  /** Unique per attempt; what the provider stores and echoes back. */
  reference: string
  /** Our checkout session reference (sent as metadata). */
  sessionReference: string
  method: PaymentMethod
  /** Major units (e.g. 15000.00 NGN). */
  amount: number
  currency: string
  email: string
  plan: { id: string; name: string }
  interval: 'monthly' | 'quarterly' | 'annual'
  callbackUrl: string
  /** For subscriptions: the provider plan id, created/cached by the executor. */
  providerPlanId?: string
}

export type CheckoutResult =
  | { kind: 'redirect'; url: string; providerReference: string }
  | { kind: 'instructions'; providerReference: string; instructions: Record<string, string> }

export type VerifyResult = { status: 'succeeded' | 'failed' | 'pending'; amount?: number; currency?: string; customerId?: string; raw?: unknown }

export type PaymentEvent =
  | { type: 'payment.succeeded'; providerReference: string; amount: number; currency: string; customerId?: string; planId?: string; sessionReference?: string; subscriptionId?: string }
  | { type: 'subscription.created'; subscriptionId: string; customerId?: string; planId?: string; meta: Record<string, string> }
  | { type: 'subscription.payment_failed'; subscriptionId: string }
  | { type: 'subscription.canceled'; subscriptionId: string }
  | { type: 'ignored'; event: string }

export interface PaymentDriver {
  readonly kind: string
  createCheckout(ctx: DriverContext, input: CheckoutInput): Promise<CheckoutResult>
  /** Create (or reuse) the provider-side plan for a subscription; returns the provider plan id. */
  ensurePlan?(ctx: DriverContext, plan: { id: string; name: string; interval: CheckoutInput['interval']; amount: number; currency: string }): Promise<string>
  verify?(ctx: DriverContext, providerReference: string): Promise<VerifyResult>
  /** Verifies the signature (throws PaymentError 401 when invalid) and normalises the event. */
  parseWebhook?(ctx: DriverContext, rawBody: string, headers: Headers): Promise<PaymentEvent>
  testConnection(ctx: DriverContext): Promise<{ ok: boolean; detail: string }>
}
