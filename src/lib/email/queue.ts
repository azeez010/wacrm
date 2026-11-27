import type { SupabaseClient } from '@supabase/supabase-js'
import { enqueueOnce } from '@/lib/crm/outbox'
import { isEmailEnabled } from '@/lib/crm/registry'
import { scheduleFlush } from '@/lib/crm'
import type { EmailMessage } from '@/lib/crm/types'
import { getEntitlements } from '@/lib/billing/entitlements'
import { renderEmail } from './render'
import { platformSender } from './platform'

/** The default sender set in the admin console (falls back to EMAIL_FROM_* while it is not set). */
export async function sender(): Promise<EmailMessage['from'] | null> {
  const s = await platformSender()
  return s ? { email: s.email, name: s.name } : null
}

async function person(db: SupabaseClient, userId: string) {
  const { data } = await db.from('profiles').select('full_name, email, locale').eq('user_id', userId).maybeSingle()
  if (!data?.email) return null
  return { email: String(data.email).toLowerCase(), name: String(data.full_name ?? '').trim().split(/\s+/)[0] ?? '', locale: (data.locale as string | null) ?? null }
}

async function ownerUserId(db: SupabaseClient, accountId: string): Promise<string | null> {
  const { data } = await db.from('accounts').select('owner_user_id').eq('id', accountId).maybeSingle()
  return (data?.owner_user_id as string | null) ?? null
}

async function queue(db: SupabaseClient, message: EmailMessage, key: string, ids: { userId?: string | null; accountId?: string | null }): Promise<boolean> {
  const queued = await enqueueOnce(db, {
    kind: 'email',
    userId: ids.userId ?? null,
    accountId: ids.accountId ?? null,
    dedupeKey: key,
    payload: message as unknown as Record<string, unknown>,
  })
  if (queued) scheduleFlush()
  return queued
}

/** The welcome email, once per person, tailored to what they said they will use. */
export async function queueWelcomeEmail(db: SupabaseClient, userId: string, accountId: string): Promise<boolean> {
  const from = await sender()
  if (!(await isEmailEnabled()) || !from) return false
  const who = await person(db, userId)
  if (!who) return false
  const { data: account } = await db.from('accounts').select('use_cases').eq('id', accountId).maybeSingle()
  const rendered = await renderEmail('welcome', who.locale, { name: who.name, useCases: (account?.use_cases as string[] | null) ?? [] })
  return queue(
    db,
    { to: { email: who.email, name: who.name || undefined }, from, subject: rendered.subject, html: rendered.html, text: rendered.text, tags: ['welcome'] },
    `once:welcome:${userId}`,
    { userId, accountId },
  )
}

/** Tell the workspace owner they are at 80% / 100% of this month's allowance. */
export async function queueQuotaEmail(
  db: SupabaseClient,
  accountId: string,
  level: 80 | 100,
  month: string,
  used: number,
  limit: number,
): Promise<boolean> {
  const from = await sender()
  if (!(await isEmailEnabled()) || !from) return false
  const userId = await ownerUserId(db, accountId)
  const who = userId ? await person(db, userId) : null
  if (!userId || !who) return false
  const { planName } = await getEntitlements(db, accountId)
  const kind = level === 100 ? 'quota_100' : 'quota_80'
  const rendered = await renderEmail(kind, who.locale, { name: who.name, planName, used, limit })
  return queue(
    db,
    { to: { email: who.email, name: who.name || undefined }, from, subject: rendered.subject, html: rendered.html, text: rendered.text, tags: [kind] },
    `once:email_${kind}:${accountId}:${month}`,
    { userId, accountId },
  )
}

/** "Your trial is ending" / "Your trial ended", to the workspace owner, once per trial. */
export async function queueTrialEmail(
  db: SupabaseClient,
  accountId: string,
  kind: 'trial_ending' | 'trial_ended',
  planName: string,
  onceId: string,
  days?: number,
): Promise<boolean> {
  const from = await sender()
  if (!(await isEmailEnabled()) || !from) return false
  const userId = await ownerUserId(db, accountId)
  const who = userId ? await person(db, userId) : null
  if (!userId || !who) return false
  const rendered = await renderEmail(kind, who.locale, { name: who.name, planName, days })
  return queue(
    db,
    { to: { email: who.email, name: who.name || undefined }, from, subject: rendered.subject, html: rendered.html, text: rendered.text, tags: [kind] },
    `once:email_${kind}:${accountId}:${onceId}`,
    { userId, accountId },
  )
}
