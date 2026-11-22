// POST /api/onboarding/otp-template - (re)create the default authentication
// template for the workspace's connected number. Admin+. Idempotent.

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { ensureOtpTemplate } from '@/lib/onboarding/otp-template'

export async function POST() {
  try {
    const ctx = await requireRole('admin')
    const db = supabaseAdmin()
    const { data: configs } = await db
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('status', 'connected')
      .order('created_at', { ascending: true })
      .limit(1)
    const configId = (configs?.[0]?.id as string | undefined) ?? null
    if (!configId) return NextResponse.json({ error: 'Connect a WhatsApp number first.' }, { status: 400 })

    const result = await ensureOtpTemplate(db, ctx.accountId, configId)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 502 })
    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
