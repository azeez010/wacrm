import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { sendPush, vapidConfig } from '@/lib/push/send'

// "Send test push": pushes to the caller's own devices only.
export async function POST() {
  try {
    const { userId, accountId } = await getCurrentAccount()
    if (!vapidConfig()) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
    const res = await sendPush(
      supabaseAdmin(),
      { accountId, userIds: [userId] },
      { title: 'OgaDesk', body: 'Test push. You will get alerts like this even when OgaDesk is closed.', url: '/settings', tag: 'push-test' },
      { urgency: 'high' },
    )
    return NextResponse.json(res)
  } catch (err) {
    return toErrorResponse(err)
  }
}
