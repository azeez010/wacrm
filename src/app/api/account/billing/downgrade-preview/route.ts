// GET /api/account/billing/downgrade-preview?plan_id=starter - what switching this workspace to that plan would
// archive (or bring back), per resource: [{ key, limit, count, archive, restore, names }]. Read-only; any member.
import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export interface ArchivePreviewItem {
  key: string
  limit: number | null
  count: number
  archive: number
  restore: number
  names: string[]
}

export async function GET(request: Request) {
  try {
    const { accountId } = await getCurrentAccount()
    const planId = new URL(request.url).searchParams.get('plan_id')?.trim()
    if (!planId || !/^[a-z0-9_-]{1,40}$/.test(planId)) {
      return NextResponse.json({ error: 'plan_id is required' }, { status: 400 })
    }
    const { data, error } = await supabaseAdmin().rpc('plan_archive_preview', { p_account: accountId, p_plan: planId })
    if (error) {
      console.error('[billing/downgrade-preview]', error.message)
      return NextResponse.json({ error: 'preview_failed' }, { status: 500 })
    }
    return NextResponse.json({ items: (Array.isArray(data) ? data : []) as ArchivePreviewItem[] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
