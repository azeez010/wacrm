// First-touch lead source for a contact: filled once, never overwritten.
// Used by forms, the inbound webhook (Click-to-WhatsApp ads), imports and the API.

export interface LeadSourceInput {
  lead_source?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_term?: string | null
  utm_content?: string | null
  source_referrer?: string | null
  source_form_id?: string | null
}

export const LEAD_SOURCE_COLUMNS = [
  'lead_source',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'source_referrer',
  'source_form_id',
] as const

/** Default lead_source labels for contact creation paths. */
export const DEFAULT_LEAD_SOURCES = {
  manual: 'Manual',
  import: 'Import',
  api: 'API',
  whatsapp: 'WhatsApp',
  ctwa: 'Click-to-WhatsApp ad',
} as const

const clean = (v: unknown, max = 300): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim().slice(0, max)
  return s === '' ? null : s
}

/**
 * The columns to write so that only EMPTY source fields are filled. `existing`
 * is the contact row (or null for a brand-new contact). Also sets first_seen_at
 * when it is still empty. Returns {} when there is nothing to add.
 */
export function firstTouchPatch(
  existing: Record<string, unknown> | null,
  incoming: LeadSourceInput,
  now: Date = new Date(),
): Record<string, string | null> {
  const patch: Record<string, string | null> = {}
  for (const col of LEAD_SOURCE_COLUMNS) {
    const next = clean(incoming[col], col === 'source_referrer' ? 1000 : 300)
    if (!next) continue
    const current = existing?.[col]
    if (current === undefined || current === null || current === '') patch[col] = next
  }
  const hasAny = Object.keys(patch).length > 0
  if (hasAny && !existing?.first_seen_at) patch.first_seen_at = now.toISOString()
  return patch
}

/** Map a submission's utm object ({source, medium, ...}) onto contact columns. */
export function utmToColumns(utm: Record<string, string> | undefined | null): LeadSourceInput {
  const u = utm ?? {}
  return {
    utm_source: u.source,
    utm_medium: u.medium,
    utm_campaign: u.campaign,
    utm_term: u.term,
    utm_content: u.content,
  }
}
