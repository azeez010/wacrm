// Currencies we can show prices in, and the usual currency per country
// (Cloudflare's `cf-ipcountry` header). Anything else falls back to USD.

export const SUPPORTED_CURRENCIES = [
  'NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR', 'UGX', 'TZS', 'RWF', 'XOF', 'XAF', 'EGP', 'MAD',
  'CAD', 'AUD', 'NZD', 'INR', 'AED', 'SAR', 'BRL', 'MXN', 'KRW', 'JPY', 'CNY', 'CHF', 'SEK', 'NOK',
  'DKK', 'PLN', 'TRY', 'SGD', 'HKD',
] as const

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]

export const isSupportedCurrency = (v: unknown): v is CurrencyCode =>
  typeof v === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(v)

const EURO = 'DE FR ES IT PT NL BE IE AT FI GR LU SK SI EE LV LT MT CY HR'.split(' ')
const XOF = 'SN CI BJ TG BF ML NE GW'.split(' ')
const XAF = 'CM GA CG TD CF GQ'.split(' ')

export const COUNTRY_CURRENCY: Record<string, CurrencyCode> = {
  NG: 'NGN', GH: 'GHS', KE: 'KES', ZA: 'ZAR', UG: 'UGX', TZ: 'TZS', RW: 'RWF', EG: 'EGP', MA: 'MAD',
  GB: 'GBP', US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', IN: 'INR', AE: 'AED', SA: 'SAR', BR: 'BRL',
  MX: 'MXN', KR: 'KRW', JP: 'JPY', CN: 'CNY', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN',
  TR: 'TRY', SG: 'SGD', HK: 'HKD',
  ...Object.fromEntries(EURO.map((c) => [c, 'EUR' as const])),
  ...Object.fromEntries(XOF.map((c) => [c, 'XOF' as const])),
  ...Object.fromEntries(XAF.map((c) => [c, 'XAF' as const])),
}

export function currencyForCountry(country: string | null | undefined): CurrencyCode | null {
  if (!country) return null
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? null
}

/**
 * Flag file (public/flags/<code>.svg) shown beside each currency. Shared
 * currencies show the issuing union's flag (EUR -> EU); XOF/XAF span several
 * countries with no flag of their own, so they have none (code only).
 */
export const CURRENCY_FLAG: Record<CurrencyCode, string | null> = {
  NGN: 'ng', USD: 'us', GBP: 'gb', EUR: 'eu', GHS: 'gh', KES: 'ke', ZAR: 'za', UGX: 'ug', TZS: 'tz',
  RWF: 'rw', XOF: null, XAF: null, EGP: 'eg', MAD: 'ma', CAD: 'ca', AUD: 'au', NZD: 'nz', INR: 'in',
  AED: 'ae', SAR: 'sa', BRL: 'br', MXN: 'mx', KRW: 'kr', JPY: 'jp', CNY: 'cn', CHF: 'ch', SEK: 'se',
  NOK: 'no', DKK: 'dk', PLN: 'pl', TRY: 'tr', SGD: 'sg', HKD: 'hk',
}
