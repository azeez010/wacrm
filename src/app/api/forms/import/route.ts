import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { formErrorResponse } from '@/lib/forms/route-helpers'
import { importForm } from '@/lib/forms/portable'

/** Create a DRAFT form from an exported file. Agents and above. */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const body = await request.json().catch(() => null)
    const { form, warnings } = await importForm(ctx.supabase, ctx.accountId, ctx.userId, body)
    return NextResponse.json({ form, warnings }, { status: 201 })
  } catch (err) {
    return formErrorResponse(err)
  }
}
