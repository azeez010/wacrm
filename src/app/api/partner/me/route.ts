// /api/partner/me - the signed-in user's partner page.
//   GET   → code, link, stats, referrals, report, materials, leaderboard
//   PATCH → display name, leaderboard opt-in, payout details
// Everyone with a login is a partner (any role). Service-role reads: payout
// details are never exposed through the client API.

import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { buildPartnerOverview } from '@/lib/partner/overview'
import { ensurePartner } from '@/lib/partner/code'
import { parsePartnerPatch } from '@/lib/partner/input'
import { checkCrmConfigOwnership } from '@/lib/partner/crm-sync'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    return NextResponse.json(await buildPartnerOverview(supabaseAdmin(), ctx.userId))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const parsed = parsePartnerPatch(await request.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const db = supabaseAdmin()
    await ensurePartner(db, ctx.userId)
    if (parsed.value.crm_config) {
      // The tag / pipeline / stage must live in the caller's own account.
      const bad = await checkCrmConfigOwnership(db, ctx.accountId, parsed.value.crm_config)
      if (bad) return NextResponse.json({ error: bad }, { status: 400 })
    }
    const { error } = await db
      .from('partners')
      .update({ ...parsed.value, updated_at: new Date().toISOString() })
      .eq('user_id', ctx.userId)
    if (error) {
      console.error('[partner] update failed:', error.message)
      return NextResponse.json({ error: 'Could not save' }, { status: 500 })
    }
    return NextResponse.json(await buildPartnerOverview(db, ctx.userId))
  } catch (err) {
    return toErrorResponse(err)
  }
}
