// Validation for what a partner can edit about themselves.

export interface PayoutDetails {
  bank_name: string
  account_name: string
  account_number: string
}

/** How a referrer's referrals land in their own CRM. Ids are checked against their account on save. */
export interface CrmConfig {
  /** The referrer's switch: off hides every CRM control and stops auto-Won. */
  enabled?: boolean
  unpaid?: { tagId: string | null; pipelineId: string | null; stageId: string | null }
  paid?: { tagId: string | null }
  autoWon?: boolean
}

export interface PartnerPatch {
  display_name?: string | null
  show_on_leaderboard?: boolean
  payout_details?: PayoutDetails
  crm_config?: CrmConfig
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const id = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v : null)

export function parseCrmConfig(raw: unknown): CrmConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  const u = (b.unpaid && typeof b.unpaid === 'object' ? b.unpaid : {}) as Record<string, unknown>
  const p = (b.paid && typeof b.paid === 'object' ? b.paid : {}) as Record<string, unknown>
  const unpaid = { tagId: id(u.tagId), pipelineId: id(u.pipelineId), stageId: id(u.stageId) }
  // A stage only makes sense with its pipeline.
  if (unpaid.stageId && !unpaid.pipelineId) return null
  return { enabled: b.enabled === true, unpaid, paid: { tagId: id(p.tagId) }, autoWon: b.autoWon !== false }
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
  if ('crm_config' in body) {
    const cfg = parseCrmConfig(body.crm_config)
    if (!cfg) return { ok: false, error: 'Invalid CRM settings' }
    out.crm_config = cfg
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
