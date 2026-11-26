// POST /api/account/billing/checkout/:reference/reported: the customer says the bank transfer was sent.
// Only flags it for the admin (who confirms it in the console); it never activates a plan.
import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function POST(_request: Request, { params }: { params: Promise<{ reference: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { reference } = await params
    const { data } = await supabaseAdmin().from('checkout_sessions').update({ status: 'transfer_reported' })
      .eq('reference', reference).eq('account_id', ctx.accountId).eq('status', 'awaiting_transfer').select('id').maybeSingle()
    if (!data) return NextResponse.json({ error: 'Not found or already handled' }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
