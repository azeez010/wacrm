import type { SupabaseClient } from '@supabase/supabase-js'
import { crmSyncUser, crmTrack } from '@/lib/crm'
import { normalizeCode } from './code'

export type AttributeResult = 'attributed' | 'invalid_code' | 'unknown_code' | 'suspended' | 'self' | 'already'

/**
 * Link a new user to the partner whose code they arrived with. The first code
 * wins (one referrer per person, enforced by a unique index), self-referrals
 * and suspended/unknown codes are ignored. Never throws for a bad code.
 */
export async function attributeReferral(
  db: SupabaseClient,
  input: { userId: string; accountId: string | null; code: unknown },
): Promise<AttributeResult> {
  const code = normalizeCode(input.code)
  if (!code) return 'invalid_code'

  const { data: partner } = await db.from('partners').select('user_id, status').eq('code', code).maybeSingle()
  if (!partner) return 'unknown_code'
  if (partner.status !== 'active') return 'suspended'
  if (partner.user_id === input.userId) return 'self'

  const { data: existing } = await db.from('referrals').select('id').eq('referred_user_id', input.userId).maybeSingle()
  if (existing) return 'already'

  const { error } = await db.from('referrals').insert({
    partner_user_id: partner.user_id,
    referred_user_id: input.userId,
    referred_account_id: input.accountId,
    code,
  })
  if (error) return 'already' // lost a race to the unique index

  await crmTrack('referral_signed_up', { userId: partner.user_id as string, properties: { referred_user_id: input.userId } })
  await crmSyncUser(input.userId)
  return 'attributed'
}
