// ============================================================
// Partner → CRM: put a referred person into the REFERRER's own CRM (contact + tag +
// pipeline deal), and move that deal to Won automatically once they pay.
//
// All queries use the service-role client and filter by account_id by hand.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { ContactError, findOrCreateContact } from '@/lib/api/v1/contacts'
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events'
import { removeContactTag } from '@/lib/contacts/tag-write'
import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils'
import type { CrmConfig } from './input'

type Db = SupabaseClient

export type AddToCrmResult =
  | { ok: true; contactId: string; dealId: string | null; alreadyAdded: boolean }
  | { ok: false; error: 'not_found' | 'needs_phone' | 'invalid_phone' | 'failed' }

/** Paid = on a non-free plan with a real (active) subscription. A free trial is not paying yet. */
export async function isAccountPaid(db: Db, accountId: string | null): Promise<boolean> {
  if (!accountId) return false
  const { data } = await db.from('account_subscriptions').select('plan_id, status').eq('account_id', accountId).maybeSingle()
  const s = data as { plan_id: string; status: string } | null
  return Boolean(s && s.plan_id !== 'free' && s.status === 'active')
}

/**
 * The pipeline's Won stage: the first final stage with outcome 'won'
 * (migration 110), else one named "Won", else the last stage.
 */
export async function findWonStageId(db: Db, pipelineId: string): Promise<string | null> {
  const { data } = await db.from('pipeline_stages').select('id, name, position, outcome').eq('pipeline_id', pipelineId).order('position', { ascending: true })
  const stages = (data ?? []) as Array<{ id: string; name: string; position: number; outcome?: string | null }>
  if (stages.length === 0) return null
  return (
    stages.find((s) => s.outcome === 'won') ??
    stages.find((s) => s.name.trim().toLowerCase() === 'won') ??
    stages[stages.length - 1]
  ).id
}

async function safeAddTag(db: Db, accountId: string, contactId: string, tagId: string | null | undefined) {
  if (!tagId) return
  try {
    await addContactTagAndDispatch({ db, accountId, contactId, tagId })
  } catch (err) {
    // The tag may have been deleted since the settings were saved; the rest still goes ahead.
    console.error('[partner-crm] tag failed:', err instanceof Error ? err.message : err)
  }
}

export async function addReferralToCrm(
  db: Db,
  input: { accountId: string; userId: string; referralId: string; config: CrmConfig; phone?: string | null },
): Promise<AddToCrmResult> {
  const { accountId, userId, referralId, config } = input
  const { data: ref } = await db
    .from('referrals')
    .select('id, referred_user_id, referred_account_id, crm_contact_id, crm_deal_id')
    .eq('id', referralId)
    .eq('partner_user_id', userId)
    .maybeSingle()
  if (!ref) return { ok: false, error: 'not_found' }
  const referral = ref as { id: string; referred_user_id: string; referred_account_id: string | null; crm_contact_id: string | null; crm_deal_id: string | null }

  if (referral.crm_contact_id) {
    const { data: still } = await db.from('contacts').select('id').eq('id', referral.crm_contact_id).eq('account_id', accountId).maybeSingle()
    if (still) return { ok: true, contactId: referral.crm_contact_id, dealId: referral.crm_deal_id, alreadyAdded: true }
  }

  const { data: prof } = await db.from('profiles').select('full_name, email, phone').eq('user_id', referral.referred_user_id).maybeSingle()
  const p = (prof ?? {}) as { full_name?: string | null; email?: string | null; phone?: string | null }

  const typed = input.phone?.trim()
  const digits = parseInternationalPhone(typed || p.phone)
  if (!digits) return { ok: false, error: typed ? 'invalid_phone' : 'needs_phone' }

  let contactId: string
  try {
    const c = await findOrCreateContact(db, accountId, userId, {
      phone: `+${digits}`,
      name: p.full_name || null,
      email: p.email || null,
      leadSource: 'Referral',
    })
    contactId = c.id
  } catch (err) {
    if (err instanceof ContactError && err.status === 400) return { ok: false, error: 'invalid_phone' }
    console.error('[partner-crm] contact failed:', err instanceof Error ? err.message : err)
    return { ok: false, error: 'failed' }
  }

  const paid = await isAccountPaid(db, referral.referred_account_id)
  await safeAddTag(db, accountId, contactId, paid ? config.paid?.tagId ?? config.unpaid?.tagId : config.unpaid?.tagId)

  let dealId: string | null = null
  const pl = config.unpaid
  if (pl?.pipelineId && pl.stageId) {
    const [{ data: stage }, { data: existing }, { data: acct }] = await Promise.all([
      db.from('pipeline_stages').select('id').eq('id', pl.stageId).eq('pipeline_id', pl.pipelineId).maybeSingle(),
      db.from('deals').select('id').eq('account_id', accountId).eq('contact_id', contactId).eq('pipeline_id', pl.pipelineId).eq('status', 'open').limit(1),
      db.from('accounts').select('default_currency').eq('id', accountId).maybeSingle(),
    ])
    if (stage) {
      const open = (existing ?? [])[0] as { id: string } | undefined
      if (open) {
        // One open deal per contact per pipeline: reuse it.
        dealId = open.id
      } else {
        const wonStage = paid && config.autoWon !== false ? await findWonStageId(db, pl.pipelineId) : null
        const { data: deal, error } = await db
          .from('deals')
          .insert({
            account_id: accountId,
            user_id: userId,
            pipeline_id: pl.pipelineId,
            stage_id: wonStage ?? pl.stageId,
            contact_id: contactId,
            title: `${p.full_name || p.email || 'Referral'} (referral)`.slice(0, 200),
            value: 0,
            currency: (acct as { default_currency?: string } | null)?.default_currency ?? 'USD',
            status: wonStage ? 'won' : 'open',
          })
          .select('id')
          .single()
        if (error) console.error('[partner-crm] deal failed:', error.message)
        dealId = (deal as { id: string } | null)?.id ?? null
      }
    }
  }

  await db.from('referrals').update({ crm_contact_id: contactId, crm_deal_id: dealId }).eq('id', referral.id)
  return { ok: true, contactId, dealId, alreadyAdded: false }
}

/**
 * A referred account just moved to a paid plan: if the referrer added them to their CRM,
 * move the deal to Won and swap the unpaid tag for the paid one. No-op otherwise.
 * Never throws - it runs beside the plan change and must not break it.
 */
export async function markReferralPaid(db: Db, referredAccountId: string): Promise<void> {
  try {
    const { data: ref } = await db
      .from('referrals')
      .select('partner_user_id, crm_contact_id, crm_deal_id')
      .eq('referred_account_id', referredAccountId)
      .not('crm_deal_id', 'is', null)
      .maybeSingle()
    const referral = ref as { partner_user_id: string; crm_contact_id: string | null; crm_deal_id: string } | null
    if (!referral) return

    const { data: partner } = await db.from('partners').select('crm_config').eq('user_id', referral.partner_user_id).maybeSingle()
    const config = ((partner as { crm_config?: CrmConfig } | null)?.crm_config ?? {}) as CrmConfig
    if (config.enabled === false || config.autoWon === false) return

    const { data: deal } = await db.from('deals').select('id, account_id, pipeline_id, status').eq('id', referral.crm_deal_id).maybeSingle()
    const d = deal as { id: string; account_id: string; pipeline_id: string; status: string } | null
    if (!d || d.status === 'won') return

    const wonStage = await findWonStageId(db, d.pipeline_id)
    const patch: Record<string, unknown> = { status: 'won' }
    if (wonStage) patch.stage_id = wonStage
    const { error } = await db.from('deals').update(patch).eq('id', d.id).eq('account_id', d.account_id)
    if (error) {
      console.error('[partner-crm] mark won failed:', error.message)
      return
    }

    if (referral.crm_contact_id) {
      await safeAddTag(db, d.account_id, referral.crm_contact_id, config.paid?.tagId)
      const unpaidTag = config.unpaid?.tagId
      if (unpaidTag && unpaidTag !== config.paid?.tagId) {
        await removeContactTag(db, { accountId: d.account_id, contactId: referral.crm_contact_id, tagId: unpaidTag }).catch(() => {})
      }
    }
  } catch (err) {
    console.error('[partner-crm] markReferralPaid failed:', err instanceof Error ? err.message : err)
  }
}

/** Returns an error message when a saved tag/pipeline/stage is not in `accountId`, else null. */
export async function checkCrmConfigOwnership(db: Db, accountId: string, config: CrmConfig): Promise<string | null> {
  for (const tagId of [config.unpaid?.tagId, config.paid?.tagId]) {
    if (!tagId) continue
    const { data } = await db.from('tags').select('id').eq('id', tagId).eq('account_id', accountId).maybeSingle()
    if (!data) return 'That tag no longer exists'
  }
  const { pipelineId, stageId } = config.unpaid ?? {}
  if (pipelineId) {
    const { data } = await db.from('pipelines').select('id').eq('id', pipelineId).eq('account_id', accountId).maybeSingle()
    if (!data) return 'That pipeline no longer exists'
    if (stageId) {
      const { data: st } = await db.from('pipeline_stages').select('id').eq('id', stageId).eq('pipeline_id', pipelineId).maybeSingle()
      if (!st) return 'That stage no longer exists'
    }
  }
  return null
}
