import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { ensureDefaultAutomations } from '@/lib/automations/seed-defaults'

/**
 * Creates the account's default automations (the Unsubscribe one) the first
 * time any editor opens the dashboard. Safe to call repeatedly.
 */
export async function POST() {
  try {
    const ctx = await requireRole('agent')
    const result = await ensureDefaultAutomations(ctx.accountId, ctx.userId)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return toErrorResponse(error)
  }
}
