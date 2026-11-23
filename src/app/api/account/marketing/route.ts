// /api/account/marketing - the signed-in user's own marketing-email choice.
//   GET → { opt_in }         PUT { opt_in: boolean } → { opt_in }
// Per person (any role), not per workspace. Service emails (receipts, quota
// alerts, security) are never affected. A change is synced to the CRM so the
// "Marketing opt-in" list follows it.

import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { crmSyncUser } from '@/lib/crm'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const { data } = await supabaseAdmin().from('profiles').select('marketing_opt_in').eq('user_id', ctx.userId).maybeSingle()
    return NextResponse.json({ opt_in: Boolean(data?.marketing_opt_in) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const body = (await request.json().catch(() => null)) as { opt_in?: unknown } | null
    if (typeof body?.opt_in !== 'boolean') return NextResponse.json({ error: 'opt_in must be true or false' }, { status: 400 })

    const { error } = await supabaseAdmin()
      .from('profiles')
      .update({ marketing_opt_in: body.opt_in, marketing_opt_in_at: body.opt_in ? new Date().toISOString() : null })
      .eq('user_id', ctx.userId)
    if (error) {
      console.error('[marketing] update failed:', error.message)
      return NextResponse.json({ error: 'Could not save' }, { status: 500 })
    }
    await crmSyncUser(ctx.userId)
    return NextResponse.json({ opt_in: body.opt_in })
  } catch (err) {
    return toErrorResponse(err)
  }
}
