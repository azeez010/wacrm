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

// ---- Who pays the provider's fee (per instance) -----------------------------------------------
// Every type carries the same fee settings. `fee_payer` defaults to the customer: the fee is added to what
// they pay (grossed up so the business still receives the full plan price). Amounts are in the instance's
// home currency; other charge currencies use `fee_percent_intl` only (no flat fee, no cap).
const NUMBER_PATTERN = '^\\d+(\\.\\d+)?$'
function feeFields(d: { percent: string; flat: string; cap: string; waivedBelow: string; intl: string }): FieldDef[] {
  return [
    {
      key: 'fee_payer', label: 'Who pays the payment fee', type: 'select', default: 'customer',
      options: [{ value: 'customer', label: 'Customer (added at checkout)' }, { value: 'business', label: 'Business (included in the price)' }],
      help: 'When the customer pays, checkout shows a transaction fee and the business receives the full plan price.',
    },
    { key: 'fee_percent', label: 'Fee percent (%)', type: 'text', default: d.percent, pattern: NUMBER_PATTERN, help: "The provider's percentage on local payments." },
    { key: 'fee_flat', label: 'Flat fee', type: 'text', default: d.flat, pattern: NUMBER_PATTERN, help: 'In the instance home currency. Leave 0 if none.' },
    { key: 'fee_cap', label: 'Fee cap', type: 'text', default: d.cap, pattern: NUMBER_PATTERN, help: 'The most the provider takes per payment. 0 = no cap.' },
    { key: 'fee_flat_waived_below', label: 'Flat fee waived below', type: 'text', default: d.waivedBelow, pattern: NUMBER_PATTERN, help: 'The flat fee is not charged on payments under this amount. 0 = never waived.' },
    { key: 'fee_percent_intl', label: 'Fee percent, other currencies (%)', type: 'text', default: d.intl, pattern: NUMBER_PATTERN, help: 'Used for payments in any currency other than the home currency.' },
  ]
}

export interface FeeResult {
  payer: 'customer' | 'business'
  /** Added to the customer's total (0 when the business pays). */
  fee: number
  /** What the customer pays: subtotal + fee. */
  total: number
  /** What the provider is expected to take from that payment (the cost when the business pays). */
  providerFee: number
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : 0
}
const cents = (n: number) => Math.round(n * 100) / 100

/** The provider fee for one payment of `subtotal` (the plan price after any coupon) in `currency`, and who bears it.
 *  Customer pays: grossed up so that total minus the provider's own fee on that total equals the subtotal,
 *  rounded up to the cent. Business pays: the total is the subtotal and `providerFee` is only the expected cost. */
export function computeFee(config: Record<string, unknown>, homeCurrency: string, currency: string, subtotal: number): FeeResult {
  const payer: FeeResult['payer'] = config.fee_payer === 'business' ? 'business' : 'customer'
  const home = currency.toUpperCase() === homeCurrency.toUpperCase()
  const pctRaw = home ? num(config.fee_percent) : (config.fee_percent_intl === undefined || config.fee_percent_intl === '' ? num(config.fee_percent) : num(config.fee_percent_intl))
  const pct = Math.min(pctRaw, 90) / 100
  const flat = home ? num(config.fee_flat) : 0
  const cap = home ? num(config.fee_cap) : 0
  const waived = home ? num(config.fee_flat_waived_below) : 0
  const s = Math.max(0, subtotal)
  if (s === 0 || (pct === 0 && flat === 0)) return { payer, fee: 0, total: cents(s), providerFee: 0 }

  const providerFeeOn = (t: number) => {
    let f = (waived > 0 && t < waived ? 0 : flat) + pct * t
    if (cap > 0) f = Math.min(f, cap)
    return f
  }
  if (payer === 'business') return { payer, fee: 0, total: cents(s), providerFee: cents(providerFeeOn(s)) }

  const noFlat = s / (1 - pct)
  let total = waived > 0 && noFlat < waived ? noFlat : (s + flat) / (1 - pct)
  if (cap > 0 && total - s > cap) total = s + cap
  total = Math.ceil(total * 100 - 1e-9) / 100
  return { payer, fee: cents(total - s), total: cents(total), providerFee: cents(providerFeeOn(total)) }
}

/** The currency an instance charges when it can: the first of its coverage currencies. */
export function homeCurrency(kind: string, config: Record<string, unknown>): string {
  const t = paymentType(kind)
  return t?.coverage(config).currencies[0] ?? 'NGN'
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
    // Defaults are Paystack Nigeria's local-card pricing; check your own Paystack pricing page.
    ...feeFields({ percent: '1.5', flat: '100', cap: '2000', waivedBelow: '2500', intl: '3.9' }),
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
    ...feeFields({ percent: '0', flat: '0', cap: '0', waivedBelow: '0', intl: '0' }),
  ],
  coverage(config) {
    return { countries: [typeof config.country === 'string' ? config.country : 'NG'], currencies: [typeof config.currency === 'string' ? config.currency : 'NGN'] }
  },
}

export const PAYMENT_TYPES: PaymentTypeDef[] = [paystack, manualTransfer]

export function paymentType(kind: string): PaymentTypeDef | undefined {
  return PAYMENT_TYPES.find((t) => t.kind === kind)
}

/** Countries the admin can tick, with their usual currency (what a customer there is charged in when an
 *  instance supports it). Kept equal to src/lib/currency/supported.ts COUNTRY_CURRENCY (tested). '*' = "everywhere else". */
export const PAYMENT_COUNTRY_CURRENCY: Record<string, string> = {
  AE: 'AED', AT: 'EUR', AU: 'AUD', BE: 'EUR', BF: 'XOF', BJ: 'XOF', BR: 'BRL', CA: 'CAD', CF: 'XAF', CG: 'XAF', CH: 'CHF', CI: 'XOF',
  CM: 'XAF', CN: 'CNY', CY: 'EUR', DE: 'EUR', DK: 'DKK', EE: 'EUR', EG: 'EGP', ES: 'EUR', FI: 'EUR', FR: 'EUR', GA: 'XAF', GB: 'GBP',
  GH: 'GHS', GQ: 'XAF', GR: 'EUR', GW: 'XOF', HK: 'HKD', HR: 'EUR', IE: 'EUR', IN: 'INR', IT: 'EUR', JP: 'JPY', KE: 'KES', KR: 'KRW',
  LT: 'EUR', LU: 'EUR', LV: 'EUR', MA: 'MAD', ML: 'XOF', MT: 'EUR', MX: 'MXN', NE: 'XOF', NG: 'NGN', NL: 'EUR', NO: 'NOK', NZ: 'NZD',
  PL: 'PLN', PT: 'EUR', RW: 'RWF', SA: 'SAR', SE: 'SEK', SG: 'SGD', SI: 'EUR', SK: 'EUR', SN: 'XOF', TD: 'XAF', TG: 'XOF', TR: 'TRY',
  TZ: 'TZS', UG: 'UGX', US: 'USD', ZA: 'ZAR',
}
export const PAYMENT_COUNTRIES = Object.keys(PAYMENT_COUNTRY_CURRENCY)
