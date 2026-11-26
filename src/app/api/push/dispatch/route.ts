import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { bellItemHref } from '@/lib/notifications/browser-notify'
import { sendPush } from '@/lib/push/send'

// Called by the database (pg_net) after a row lands in `notifications`.
// Authenticated with a shared secret, never by a user session.

function secretOk(given: string | null): boolean {
  const expected = process.env.PUSH_DISPATCH_SECRET
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  if (!secretOk(request.headers.get('x-push-secret'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null
  if (typeof body?.id !== 'string') return NextResponse.json({ error: 'bad request' }, { status: 400 })

  const db = supabaseAdmin()
  const { data: n } = await db
    .from('notifications')
    .select('id, account_id, user_id, conversation_id, contact_id, title, body')
    .eq('id', body.id)
    .maybeSingle()
  if (!n) return NextResponse.json({ ok: true, sent: 0 })

  const res = await sendPush(
    db,
    { accountId: n.account_id, userIds: [n.user_id] },
    { title: n.title, body: n.body ?? undefined, url: bellItemHref(n), tag: `notif-${n.id}` },
  )
  return NextResponse.json({ ok: true, ...res })
}
