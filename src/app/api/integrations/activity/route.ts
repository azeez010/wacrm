// /api/integrations/activity - GET: the latest AI tool calls (arguments are stored redacted). ?status=pending_approval
// filters. Members can read (the inbox approval banner uses the same data).

import { NextResponse } from 'next/server'

import { getCurrentAccount } from '@/lib/auth/account'
import { redact } from '@/lib/ai/tools/registry'
import { integrationError } from '@/lib/integrations/http'

const STATUSES = new Set(['ok', 'error', 'pending_approval', 'approved', 'rejected', 'expired', 'proposed'])

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const conversation = url.searchParams.get('conversation_id')
    let q = ctx.supabase
      .from('ai_tool_calls')
      .select('id, conversation_id, agent_id, integration_id, tool_name, mode, kind, arguments, summary, result, status, error, duration_ms, decided_by, decided_at, expires_at, created_at')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (status && STATUSES.has(status)) q = q.eq('status', status)
    if (conversation) q = q.eq('conversation_id', conversation)
    const { data, error } = await q
    if (error) {
      console.error('[GET /api/integrations/activity]', error)
      return NextResponse.json({ error: 'Could not load activity' }, { status: 500 })
    }
    return NextResponse.json({ calls: (data ?? []).map((c) => ({ ...c, arguments: redact(c.arguments) })) })
  } catch (err) {
    return integrationError(err, 'GET /api/integrations/activity')
  }
}
