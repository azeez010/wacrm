// Validation for what a partner can edit about themselves.

export interface PayoutDetails {
  bank_name: string
  account_name: string
  account_number: string
}

export interface PartnerPatch {
  display_name?: string | null
  show_on_leaderboard?: boolean
  payout_details?: PayoutDetails
}

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export function parsePartnerPatch(raw: unknown): { ok: true; value: PartnerPatch } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid request' }
  const body = raw as Record<string, unknown>
  const out: PartnerPatch = {}

  if ('display_name' in body) {
    if (body.display_name !== null && typeof body.display_name !== 'string') return { ok: false, error: 'Invalid display name' }
    const name = clean(body.display_name, 60)
    out.display_name = name || null
  }
  if ('show_on_leaderboard' in body) {
    if (typeof body.show_on_leaderboard !== 'boolean') return { ok: false, error: 'Invalid leaderboard setting' }
    out.show_on_leaderboard = body.show_on_leaderboard
  }
  if ('payout_details' in body) {
    const p = body.payout_details as Record<string, unknown> | null
    if (!p || typeof p !== 'object') return { ok: false, error: 'Invalid payout details' }
    const details = {
      bank_name: clean(p.bank_name, 80),
      account_name: clean(p.account_name, 80),
      account_number: clean(p.account_number, 34).replace(/\s+/g, ''),
    }
    const empty = !details.bank_name && !details.account_name && !details.account_number
    if (!empty) {
      if (!details.bank_name || !details.account_name) return { ok: false, error: 'Bank name and account name are required' }
      if (!/^[A-Za-z0-9-]{6,34}$/.test(details.account_number)) return { ok: false, error: 'Enter a valid account number' }
    }
    out.payout_details = details
  }
  if (Object.keys(out).length === 0) return { ok: false, error: 'Nothing to update' }
  return { ok: true, value: out }
}

/** "jane.doe@gmail.com" → "ja***@gmail.com" - referrals show people, not inboxes. */
export function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes('@')) return '—'
  const [local, domain] = email.split('@')
  return `${local.slice(0, 2)}***@${domain}`
}
