// ============================================================
// Helpers for bulk actions on the Contacts page (tag, untag, add deal).
// Pure and unit-tested; the dialogs own the UI and network calls.
// ============================================================

export interface BulkProgress {
  done: number
  total: number
}

export interface BulkOutcome {
  ok: number
  skipped: number
  failed: number
  /** First few failures, for the result block. */
  errors: { id: string; reason: string }[]
}

export type ItemResult = 'ok' | 'skipped'

/**
 * Run `fn` over `items` with at most `limit` in flight. `fn` returns 'ok' or
 * 'skipped' (e.g. already tagged); a throw counts as failed. Never rejects:
 * one bad contact must not sink the rest.
 */
export async function runBulk<T extends { id: string }>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<ItemResult>,
  onProgress?: (p: BulkProgress) => void,
): Promise<BulkOutcome> {
  const outcome: BulkOutcome = { ok: 0, skipped: 0, failed: 0, errors: [] }
  let next = 0
  let done = 0
  async function worker() {
    while (next < items.length) {
      const item = items[next++]
      try {
        const r = await fn(item)
        if (r === 'skipped') outcome.skipped++
        else outcome.ok++
      } catch (err) {
        outcome.failed++
        if (outcome.errors.length < 20) {
          outcome.errors.push({ id: item.id, reason: err instanceof Error ? err.message : String(err) })
        }
      }
      done++
      onProgress?.({ done, total: items.length })
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return outcome
}

export interface DealContact {
  id: string
  name?: string | null
  phone: string
}

/** Fill `{name}` / `{phone}` in a deal title template for one contact. */
export function dealTitle(template: string, contact: DealContact): string {
  const name = contact.name?.trim() || contact.phone
  const title = template
    .replace(/\{name\}/gi, name)
    .replace(/\{phone\}/gi, contact.phone)
    .trim()
  return (title || name).slice(0, 200)
}

export interface DealRowInput {
  contacts: DealContact[]
  titleTemplate: string
  pipelineId: string
  stageId: string
  value: number
  currency: string
  userId: string
  accountId: string
}

/** One deals row per selected contact (same columns the single-deal form writes). */
export function buildDealRows(input: DealRowInput) {
  return input.contacts.map((c) => ({
    title: dealTitle(input.titleTemplate, c),
    value: input.value,
    currency: input.currency,
    contact_id: c.id,
    pipeline_id: input.pipelineId,
    stage_id: input.stageId,
    user_id: input.userId,
    account_id: input.accountId,
    status: 'open' as const,
  }))
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** sessionStorage key carrying selected contact ids into the broadcast wizard. */
export const BROADCAST_CONTACTS_KEY = 'wacrm:broadcast-contact-ids'
