// ============================================================
// Payment TYPES (templates). Pure data + pure functions, no imports, so the admin API keeps a
// byte-identical copy (ogadesk-api/src/lib/payment-catalogue.ts, drift-tested).
//
// A type says what it can do (methods), what an admin must fill in (fields) and which countries /
// currencies an instance can serve given its config (coverage), which is what auto-ticks the
// countries in the admin. Adding a provider = one entry here + one driver in ./drivers.
// ============================================================

export type PaymentMethod = 'checkout_link' | 'subscription' | 'bank_transfer'
export const PAYMENT_METHODS: PaymentMethod[] = ['checkout_link', 'subscription', 'bank_transfer']

export type FieldType = 'text' | 'secret' | 'select' | 'boolean' | 'textarea'
export interface FieldDef {
  key: string
  label: string
  type: FieldType
  required?: boolean
  help?: string
  options?: { value: string; label: string }[]
  default?: string | boolean
  /** Regex a text/secret value must match (as a string so it survives JSON). */
  pattern?: string
}

export interface Coverage {
  /** ISO 3166-1 alpha-2 codes; '*' = every other country. */
  countries: string[]
  currencies: string[]
}

export interface PaymentTypeDef {
  kind: string
  label: string
  description: string
  methods: PaymentMethod[]
  fields: FieldDef[]
  /** True when the provider calls our webhook (a URL to paste into its dashboard). */
  webhook: boolean
  coverage(config: Record<string, unknown>): Coverage
  /** Extra checks on a config + secrets (returns error messages). */
  validate?(config: Record<string, unknown>, secrets: Record<string, string>, mode: 'test' | 'live'): string[]
}

// Paystack: an account charges its home currency (plus USD for Nigeria / Kenya businesses that
// enabled it); cards from any country work when international payments are on.
const PAYSTACK_HOME: Record<string, string> = { NG: 'NGN', GH: 'GHS', ZA: 'ZAR', KE: 'KES', CI: 'XOF' }

const paystack: PaymentTypeDef = {
  kind: 'paystack',
  label: 'Paystack',
  description: 'Cards, bank, USSD and pay-by-transfer on a Paystack-hosted page; automatic renewals with Paystack subscriptions.',
  methods: ['checkout_link', 'subscription'],
  webhook: true,
  fields: [
    { key: 'secret_key', label: 'Secret key', type: 'secret', required: true, pattern: '^sk_(test|live)_[A-Za-z0-9]+$', help: 'Paystack → Settings → API Keys & Webhooks. sk_test_… for test mode, sk_live_… for live.' },
    { key: 'public_key', label: 'Public key', type: 'text', pattern: '^pk_(test|live)_[A-Za-z0-9]+$', help: 'Optional; not needed for hosted checkout.' },
    {
      key: 'merchant_country', label: 'Paystack account country', type: 'select', required: true, default: 'NG',
      options: [{ value: 'NG', label: 'Nigeria' }, { value: 'GH', label: 'Ghana' }, { value: 'ZA', label: 'South Africa' }, { value: 'KE', label: 'Kenya' }, { value: 'CI', label: "Côte d'Ivoire" }],
    },
    { key: 'usd_enabled', label: 'USD payments enabled on this account', type: 'boolean', default: false, help: 'Only for Nigeria and Kenya accounts that Paystack approved for USD.' },
    { key: 'international_cards', label: 'International cards enabled', type: 'boolean', default: true, help: 'When on, customers in any country can pay by card.' },
  ],
  coverage(config) {
    const mc = typeof config.merchant_country === 'string' && PAYSTACK_HOME[config.merchant_country] ? config.merchant_country : 'NG'
    const currencies = [PAYSTACK_HOME[mc]!]
    if (config.usd_enabled === true && (mc === 'NG' || mc === 'KE')) currencies.push('USD')
    return { countries: config.international_cards === false ? [mc] : [mc, '*'], currencies }
  },
  validate(_config, secrets, mode) {
    const key = secrets.secret_key ?? ''
    if (key && !key.startsWith(mode === 'live' ? 'sk_live_' : 'sk_test_')) return [`The secret key does not match ${mode} mode (expected ${mode === 'live' ? 'sk_live_' : 'sk_test_'}…).`]
    return []
  },
}

const manualTransfer: PaymentTypeDef = {
  kind: 'manual_transfer',
  label: 'Manual bank transfer',
  description: 'Customers see your bank details and a payment reference; you confirm the payment in the admin console.',
  methods: ['bank_transfer'],
  webhook: false,
  fields: [
    { key: 'bank_name', label: 'Bank name', type: 'text', required: true },
    { key: 'account_name', label: 'Account name', type: 'text', required: true },
    { key: 'account_number', label: 'Account number', type: 'text', required: true },
    { key: 'currency', label: 'Account currency', type: 'select', required: true, default: 'NGN', options: ['NGN', 'GHS', 'KES', 'ZAR', 'USD', 'GBP', 'EUR'].map((c) => ({ value: c, label: c })) },
    { key: 'country', label: 'Bank country', type: 'select', required: true, default: 'NG', options: ['NG', 'GH', 'KE', 'ZA', 'US', 'GB'].map((c) => ({ value: c, label: c })) },
    { key: 'instructions', label: 'Extra instructions', type: 'textarea', help: 'Shown under the bank details, e.g. "Send the receipt to billing@…".' },
  ],
  coverage(config) {
    return { countries: [typeof config.country === 'string' ? config.country : 'NG'], currencies: [typeof config.currency === 'string' ? config.currency : 'NGN'] }
  },
}

export const PAYMENT_TYPES: PaymentTypeDef[] = [paystack, manualTransfer]

export function paymentType(kind: string): PaymentTypeDef | undefined {
  return PAYMENT_TYPES.find((t) => t.kind === kind)
}

/** Countries the admin can tick (Paystack homes + the currency map), alphabetical; '*' is "everywhere else". */
export const PAYMENT_COUNTRIES = [
  'AE', 'AT', 'AU', 'BE', 'BF', 'BJ', 'BR', 'CA', 'CF', 'CG', 'CH', 'CI', 'CM', 'CN', 'CY', 'DE', 'DK', 'EE', 'EG', 'ES', 'FI', 'FR',
  'GA', 'GB', 'GH', 'GQ', 'GR', 'GW', 'HK', 'HR', 'IE', 'IN', 'IT', 'JP', 'KE', 'KR', 'LT', 'LU', 'LV', 'MA', 'ML', 'MT', 'MX', 'NE',
  'NG', 'NL', 'NO', 'NZ', 'PL', 'PT', 'RW', 'SA', 'SE', 'SG', 'SI', 'SK', 'SN', 'TD', 'TG', 'TR', 'TZ', 'UG', 'US', 'ZA',
]
