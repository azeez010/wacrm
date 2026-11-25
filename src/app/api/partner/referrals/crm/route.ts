// POST /api/partner/referrals/crm - add every referral not yet in the CRM that has a phone.

import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { addReferralToCrm } from '@/lib/partner/crm-sync'
import type { CrmConfig } from '@/lib/partner/input'

export async function POST() {
  try {
    const ctx = await getCurrentAccount()
    const db = supabaseAdmin()
    const { data: partner } = await db.from('partners').select('crm_config').eq('user_id', ctx.userId).maybeSingle()
    const config = ((partner as { crm_config?: CrmConfig } | null)?.crm_config ?? {}) as CrmConfig
    const { data: refs } = await db
      .from('referrals')
      .select('id')
      .eq('partner_user_id', ctx.userId)
      .is('crm_contact_id', null)
      .order('created_at', { ascending: false })
      .limit(200)
    let added = 0
    let skipped = 0
    for (const r of (refs ?? []) as Array<{ id: string }>) {
      const res = await addReferralToCrm(db, { accountId: ctx.accountId, userId: ctx.userId, referralId: r.id, config })
      if (res.ok) added++
      else skipped++ // no phone on file, or a failure: the referrer can add those one by one
    }
    return NextResponse.json({ added, skipped })
  } catch (err) {
    return toErrorResponse(err)
  }
}
