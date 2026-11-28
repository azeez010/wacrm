import type { CrmAttributes } from './types'

// The single catalogue of contact attributes we keep in the CRM. Adding one =
// add it here and set it in snapshot.ts; the provider creates it on first sync.
// (Brevo allows 200 custom attributes per account; we use ~31.)

export type AttributeType = 'text' | 'float' | 'date' | 'boolean'

export const CRM_ATTRIBUTES = {
  // identity / role
  OGA_USER_ID: 'text',
  OGA_ACCOUNT_ID: 'text',
  ROLE: 'text',
  // onboarding
  USE_CASES: 'text', // comma-separated: developer,support,sales,marketing
  HEARD_FROM: 'text',
  HEARD_FROM_DETAIL: 'text',
  REFERRAL_CODE: 'text',
  ONBOARDED_AT: 'date',
  // plan + billing
  PLAN: 'text',
  PLAN_STATUS: 'text',
  BILLING_INTERVAL: 'text',
  PLAN_RENEWS_AT: 'date',
  TRIAL_ENDS_AT: 'date', // while on a free trial (PLAN_STATUS = trialing)
  LIFETIME_PAID: 'float',
  // profile
  PHONE: 'text', // WhatsApp number (+234...), kept here even when another contact already owns it as its phone
  LANGUAGE: 'text',
  COUNTRY: 'text',
  TIMEZONE: 'text',
  SIGNED_UP_AT: 'date',
  // product usage
  WHATSAPP_CONNECTED: 'boolean',
  WHATSAPP_NUMBERS: 'float',
  API_KEYS: 'float',
  WEBHOOK_ENDPOINTS: 'float',
  MEMBERS: 'float',
  MESSAGES_THIS_MONTH: 'float',
  MESSAGE_LIMIT: 'float',
  QUOTA_PERCENT: 'float',
  // partner program
  PARTNER_CODE: 'text',
  REFERRALS_COUNT: 'float',
  REFERRED_BY: 'text', // partner code that brought this user
  // consent
  MARKETING_OPT_IN: 'boolean',
} as const satisfies Record<string, AttributeType>

/** Attributes every Brevo account already has; never created by us. */
export const BUILTIN_ATTRIBUTES = ['FIRSTNAME', 'LASTNAME'] as const

export type CrmAttributeName = keyof typeof CRM_ATTRIBUTES

/** Lists the app manages (provider-agnostic names; adapters may prefix them). */
export const CRM_LISTS = {
  all: 'All users',
  marketing: 'Marketing opt-in',
  developer: 'Use case: Developer API',
  support: 'Use case: Support',
  sales: 'Use case: Sales',
  marketingUse: 'Use case: Marketing',
} as const

export const USE_CASE_LISTS: Record<string, string> = {
  developer: CRM_LISTS.developer,
  support: CRM_LISTS.support,
  sales: CRM_LISTS.sales,
  marketing: CRM_LISTS.marketingUse,
}

export const ALL_MANAGED_LISTS: string[] = Object.values(CRM_LISTS)

/** Keep only attributes we know (drops typos before they reach the provider). */
export function pickKnownAttributes(attrs: CrmAttributes): CrmAttributes {
  const out: CrmAttributes = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (k in CRM_ATTRIBUTES || (BUILTIN_ATTRIBUTES as readonly string[]).includes(k)) out[k] = v
  }
  return out
}
