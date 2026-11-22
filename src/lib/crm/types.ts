// Provider-agnostic CRM / email contracts. The rest of the app talks to these
// interfaces only; a provider (Brevo today) is one adapter file that implements
// them and is chosen by CRM_PROVIDER / EMAIL_PROVIDER (see registry.ts).

export type AttributeValue = string | number | boolean | null

export type CrmAttributes = Record<string, AttributeValue>

/** A person to keep in sync in the CRM. */
export interface CrmContact {
  /** Stable key in our system (the Supabase user id). */
  externalId: string
  email: string
  attributes: CrmAttributes
  /** Names of the lists/segments the person should be in (managed in full). */
  lists: string[]
}

export interface CrmEvent {
  name: string
  email: string
  /** ISO timestamp; defaults to now at the provider. */
  at?: string
  properties?: Record<string, string | number | boolean>
}

export interface EmailMessage {
  to: { email: string; name?: string }
  from: { email: string; name?: string }
  subject: string
  html: string
  text: string
  tags?: string[]
}

/**
 * Thrown by adapters. `retryable` tells the outbox whether trying again can
 * help (network, 429, 5xx) or not (bad request, auth, plan limits).
 */
export class CrmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'CrmError'
  }
}

export interface CrmProvider {
  readonly name: string
  /** Create whatever the provider needs first (attributes, lists). Idempotent. */
  ensureSchema(): Promise<void>
  upsertContact(contact: CrmContact): Promise<void>
  trackEvent(event: CrmEvent): Promise<void>
}

export interface EmailProvider {
  readonly name: string
  send(message: EmailMessage): Promise<{ id?: string }>
}
