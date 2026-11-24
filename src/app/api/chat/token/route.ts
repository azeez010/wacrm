import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { chatSecret } from '@/lib/chat/http'
import { AGENT_TOKEN_TTL_S, signChatToken } from '@/lib/chat/token'

/**
 * Lets a signed-in teammate join a live-chat room's WebSocket (typing and
 * "visitor is here"). The token is short-lived and scoped to one conversation
 * of the caller's own account.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const body = (await request.json().catch(() => null)) as { conversation_id?: unknown } | null
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : ''
    if (!/^[0-9a-fA-F-]{36}$/.test(conversationId)) return NextResponse.json({ error: 'conversation_id required' }, { status: 400 })

    const { data } = await supabaseAdmin()
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .eq('channel', 'web_chat')
      .maybeSingle()
    if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 })

    const token = await signChatToken(
      { cid: conversationId, aid: ctx.accountId, sub: ctx.userId, role: 'agent', exp: Math.floor(Date.now() / 1000) + AGENT_TOKEN_TTL_S },
      chatSecret(),
    )
    return NextResponse.json({ token, path: `/ws/chat/${conversationId}` })
  } catch (error) {
    return toErrorResponse(error)
  }
}
