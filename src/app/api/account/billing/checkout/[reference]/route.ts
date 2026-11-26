// GET /api/account/billing/checkout/:reference: the checkout's status for the return page.
// A checkout still at the provider is verified with it (and settled when paid), so the plan
// switches even if the provider's webhook is late. Only the account's own checkouts.
import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { verifyCheckout } from '@/lib/payments/checkout'

export async function GET(_request: Request, { params }: { params: Promise<{ reference: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { reference } = await params
    const db = supabaseAdmin()
    const { data: s } = await db.from('checkout_sessions').select('id, status, plan_id, billing_interval, method, amount, currency, instructions, account_id')
      .eq('reference', reference).eq('account_id', ctx.accountId).maybeSingle()
    if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    let status = s.status as string
    if (status === 'redirected') {
      try {
        status = (await verifyCheckout(db, reference)).sessionStatus
      } catch (e) {
        console.error('[billing] verify failed:', e instanceof Error ? e.message : e)
      }
    }
    return NextResponse.json({
      reference, status, planId: s.plan_id, interval: s.billing_interval, method: s.method, amount: s.amount, currency: s.currency,
      instructions: s.method === 'bank_transfer' ? s.instructions : null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
