import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { formErrorResponse } from '@/lib/forms/route-helpers'
import { createFormFromTemplate } from '@/lib/forms/server'

/** Create a form from a starter template. Agents and above. */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const body = (await request.json().catch(() => null)) as { template?: string; name?: string } | null
    if (!body?.template) return NextResponse.json({ error: 'template is required' }, { status: 400 })
    const form = await createFormFromTemplate(ctx.supabase, ctx.accountId, ctx.userId, {
      template: body.template,
      name: body.name,
    })
    return NextResponse.json({ form }, { status: 201 })
  } catch (err) {
    return formErrorResponse(err)
  }
}
