// GET /api/onboarding/developer - the state of the developer checklist
// (connect a number → OTP template → API key → test code). Any member.

import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { OTP_TEMPLATE_NAME } from '@/lib/onboarding/otp-template'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const db = supabaseAdmin()
    const [{ data: account }, { data: configs }, { data: templates }, keys, otp] = await Promise.all([
      db.from('accounts').select('use_cases').eq('id', ctx.accountId).maybeSingle(),
      db.from('whatsapp_config').select('id, status').eq('account_id', ctx.accountId).order('created_at', { ascending: true }),
      db
        .from('message_templates')
        .select('status, rejection_reason, whatsapp_config_id')
        .eq('account_id', ctx.accountId)
        .eq('name', OTP_TEMPLATE_NAME),
      db.from('api_keys').select('id', { count: 'exact', head: true }).eq('account_id', ctx.accountId).is('revoked_at', null),
      db.from('otp_verifications').select('id', { count: 'exact', head: true }).eq('account_id', ctx.accountId),
    ])

    const connected = ((configs ?? []) as Array<{ id: string; status: string }>).find((c) => c.status === 'connected')
    const tpl = ((templates ?? []) as Array<{ status: string | null; rejection_reason: string | null }>)[0] ?? null
    return NextResponse.json({
      show: Array.isArray(account?.use_cases) && (account!.use_cases as string[]).includes('developer'),
      whatsappConnected: Boolean(connected),
      template: tpl ? { exists: true, status: tpl.status, rejectionReason: tpl.rejection_reason } : { exists: false, status: null, rejectionReason: null },
      hasApiKey: (keys.count ?? 0) > 0,
      hasSentOtp: (otp.count ?? 0) > 0,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
