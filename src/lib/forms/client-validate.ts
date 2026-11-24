import { normalizeFormPhone } from './countries'

// ============================================================
// Shared "is this rubbish?" rules for public forms and the live chat. Pure and
// dependency-free so the browser and the servers apply the same checks.
// Each returns an error code (a key of PublicStrings) or null when fine.
// ============================================================

export type ValidationCode = 'required' | 'invalid_name' | 'invalid_email' | 'invalid_phone' | 'invalid_message'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** "aaaa", "....", "1111": one character repeated (ignoring spaces). */
function isRepeatedChar(s: string): boolean {
  const t = s.replace(/\s+/g, '')
  return t.length >= 3 && new Set(Array.from(t.toLowerCase())).size === 1
}

const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length

export function validateName(raw: string, required: boolean): ValidationCode | null {
  const s = raw.trim()
  if (!s) return required ? 'required' : null
  if (s.length > 120 || letters(s) < 2 || isRepeatedChar(s)) return 'invalid_name'
  return null
}

export function validateEmail(raw: string, required: boolean): ValidationCode | null {
  const s = raw.trim()
  if (!s) return required ? 'required' : null
  if (s.length > 254 || !EMAIL_RE.test(s)) return 'invalid_email'
  return null
}

/** `composed` is what composeFormPhone produced (+digits, or the raw text when it cannot be a number). */
export function validatePhone(composed: string, required: boolean): ValidationCode | null {
  const s = composed.trim()
  if (!s) return required ? 'required' : null
  const e164 = normalizeFormPhone(s)
  if (!e164) return 'invalid_phone'
  const digits = e164.slice(1)
  // Reject placeholders such as +2340000000000 / 1111111111 (one digit, after the country code too).
  if (new Set(digits.slice(-8)).size === 1) return 'invalid_phone'
  return null
}

export function validateMessage(raw: string, required = true, max = 4000): ValidationCode | null {
  const s = raw.trim()
  if (!s) return required ? 'required' : null
  if (s.length > max || !/[\p{L}\p{N}]/u.test(s) || isRepeatedChar(s)) return 'invalid_message'
  return null
}
