import { callingCode, findCountry } from './countries'

export type PhoneHint =
  | { state: 'empty' }
  | { state: 'partial' }
  | { state: 'invalid' }
  | { state: 'valid'; formatted: string; country: string }

const MIN_DIGITS = 8 // country code + number, E.164 lower bound used across the app
const MAX_DIGITS = 15

/** "8127423455" -> "812 742 3455". */
function groupNational(national: string): string {
  const d = national.replace(/\D/g, '')
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6)].filter(Boolean).join(' ')
}

/**
 * What to tell the person typing a number: nothing yet, keep typing, not a number, or "looks good" with the number
 * shown back in readable form. `full` is the international value the field emits ("+2348127423455" or "").
 */
export function phoneHint(full: string, iso: string): PhoneHint {
  const digits = full.replace(/\D/g, '')
  if (!full.trim()) return { state: 'empty' }
  const cc = callingCode(iso)
  const national = digits.startsWith(cc) ? digits.slice(cc.length) : digits
  if (!national) return { state: 'empty' }
  if (digits.length > MAX_DIGITS) return { state: 'invalid' }
  if (digits.length < MIN_DIGITS) return { state: 'partial' }
  return { state: 'valid', formatted: `+${cc} ${groupNational(national)}`, country: findCountry(iso)?.name ?? '' }
}
