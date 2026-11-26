import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

// Register / remove this device for background push. Any signed-in member may.

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048).startsWith('https://'),
  keys: z.object({ p256dh: z.string().min(80).max(200), auth: z.string().min(16).max(64) }),
})

export async function POST(request: Request) {
  try {
    const { userId, accountId } = await getCurrentAccount()
    const parsed = subscribeSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
    const { endpoint, keys } = parsed.data
    const { error } = await supabaseAdmin()
      .from('push_subscriptions')
      .upsert(
        {
          account_id: accountId,
          user_id: userId,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          user_agent: (request.headers.get('user-agent') ?? '').slice(0, 300),
        },
        { onConflict: 'endpoint' },
      )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const { userId } = await getCurrentAccount()
    const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null
    if (typeof body?.endpoint !== 'string') return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
    await supabaseAdmin().from('push_subscriptions').delete().eq('endpoint', body.endpoint).eq('user_id', userId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
