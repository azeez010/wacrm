// POST /api/partner/referrals/:id/crm  { phone? }
// Add one referral to the caller's own CRM (contact + tag + deal). Answers
// { error: 'needs_phone' } (409) when the referee has no number on file.

import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { addReferralToCrm } from '@/lib/partner/crm-sync'
import type { CrmConfig } from '@/lib/partner/input'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getCurrentAccount()
    const { id } = await params
    const body = (await request.json().catch(() => null)) as { phone?: unknown } | null
    const db = supabaseAdmin()
    const { data: partner } = await db.from('partners').select('crm_config').eq('user_id', ctx.userId).maybeSingle()
    const result = await addReferralToCrm(db, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      referralId: id,
      config: ((partner as { crm_config?: CrmConfig } | null)?.crm_config ?? {}) as CrmConfig,
      phone: typeof body?.phone === 'string' ? body.phone : null,
    })
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : result.error === 'failed' ? 500 : result.error === 'needs_phone' ? 409 : 400
      return NextResponse.json({ error: result.error }, { status })
    }
    return NextResponse.json({ contactId: result.contactId, dealId: result.dealId })
  } catch (err) {
    return toErrorResponse(err)
  }
}
