import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { ensureDefaultAutomations } from '@/lib/automations/seed-defaults'
import { ensureDefaultSegments } from '@/lib/segments/seed-defaults'

/**
 * Creates the account's defaults (the Unsubscribe automation and the Blocked / Not blocked segments) the first
 * time any editor opens the dashboard. Safe to call repeatedly.
 */
export async function POST() {
  try {
    const ctx = await requireRole('agent')
    const result = await ensureDefaultAutomations(ctx.accountId, ctx.userId)
    // After the automations: both append to accounts.seeded_defaults, and the
    // segments seeder re-reads it so it never overwrites that write.
    const segments = await ensureDefaultSegments(ctx.accountId, ctx.userId)
    return NextResponse.json({ ok: true, created: [...result.created, ...segments.created] })
  } catch (error) {
    return toErrorResponse(error)
  }
}
