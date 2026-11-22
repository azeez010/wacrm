// Default-country handling for the form phone field: Nigerian visitors type
// 0803..., so a form needs to know which calling code to put in front.

export interface Country {
  iso: string
  name: string
  cc: string
}

/** Common markets first; extend as needed. */
export const COUNTRIES: Country[] = [
  { iso: 'NG', name: 'Nigeria', cc: '234' },
  { iso: 'GH', name: 'Ghana', cc: '233' },
  { iso: 'KE', name: 'Kenya', cc: '254' },
  { iso: 'ZA', name: 'South Africa', cc: '27' },
  { iso: 'UG', name: 'Uganda', cc: '256' },
  { iso: 'TZ', name: 'Tanzania', cc: '255' },
  { iso: 'EG', name: 'Egypt', cc: '20' },
  { iso: 'SN', name: 'Senegal', cc: '221' },
  { iso: 'CI', name: "Côte d'Ivoire", cc: '225' },
  { iso: 'CM', name: 'Cameroon', cc: '237' },
  { iso: 'GB', name: 'United Kingdom', cc: '44' },
  { iso: 'US', name: 'United States', cc: '1' },
  { iso: 'CA', name: 'Canada', cc: '1' },
  { iso: 'IN', name: 'India', cc: '91' },
  { iso: 'AE', name: 'United Arab Emirates', cc: '971' },
  { iso: 'SA', name: 'Saudi Arabia', cc: '966' },
  { iso: 'BR', name: 'Brazil', cc: '55' },
  { iso: 'PT', name: 'Portugal', cc: '351' },
  { iso: 'ES', name: 'Spain', cc: '34' },
  { iso: 'MX', name: 'Mexico', cc: '52' },
  { iso: 'FR', name: 'France', cc: '33' },
  { iso: 'DE', name: 'Germany', cc: '49' },
  { iso: 'KR', name: 'South Korea', cc: '82' },
  { iso: 'PH', name: 'Philippines', cc: '63' },
  { iso: 'ID', name: 'Indonesia', cc: '62' },
  { iso: 'PK', name: 'Pakistan', cc: '92' },
  { iso: 'BD', name: 'Bangladesh', cc: '880' },
]

export const DEFAULT_COUNTRY = 'NG'

export function callingCode(iso: string | undefined | null): string {
  const c = COUNTRIES.find((x) => x.iso === (iso ?? '').toUpperCase())
  return (c ?? COUNTRIES[0]).cc
}

/**
 * Turn what a visitor typed into "+<digits>" ready for the contact upsert, or
 * null when it cannot be a phone number.
 *
 *  +2348031234567   -> +2348031234567
 *  002348031234567  -> +2348031234567
 *  08031234567      -> +2348031234567   (national, trunk 0 dropped, default country)
 *  2348031234567    -> +2348031234567   (already starts with the calling code)
 */
export function normalizeFormPhone(raw: unknown, defaultIso?: string | null): string | null {
  if (typeof raw !== 'string') return null
  let s = raw.trim().replace(/[\s().-]/g, '')
  if (!s) return null
  let digits: string
  if (s.startsWith('+')) {
    digits = s.slice(1)
  } else if (s.startsWith('00')) {
    digits = s.slice(2)
  } else {
    const cc = callingCode(defaultIso)
    const d = s
    if (!/^\d+$/.test(d)) return null
    if (d.startsWith(cc) && d.length >= cc.length + 8) digits = d
    else digits = cc + d.replace(/^0+/, '')
  }
  s = digits
  if (!/^\d+$/.test(s)) return null
  // E.164: at most 15 digits; at least a country code plus a few digits.
  if (s.length < 8 || s.length > 15) return null
  return '+' + s
}

/** Client-side: what the visitor typed + the country picked, as +digits (or the raw text if it cannot be one). */
export function composeFormPhone(raw: unknown, iso: string): string {
  return normalizeFormPhone(raw, iso) ?? String(raw ?? '').trim()
}

/** Country the picker starts on: the fixed one, or the visitor's (Cloudflare), or Nigeria. */
export function resolveDefaultCountry(setting: string | undefined | null, detected: string | undefined | null): string {
  const known = (iso?: string | null) => (iso && COUNTRIES.some((c) => c.iso === iso.toUpperCase()) ? iso.toUpperCase() : null)
  if (!setting || setting === 'auto') return known(detected) ?? DEFAULT_COUNTRY
  return known(setting) ?? DEFAULT_COUNTRY
}
