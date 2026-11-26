// /api/integrations/[id]/discover - POST: re-list an MCP server's tools (keeps the business's per-tool choices). Admins.

import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { TOOL_PUBLIC_COLUMNS, rediscoverMcp } from '@/lib/integrations/manage'
import { integrationError } from '@/lib/integrations/http'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const rl = checkRateLimit(`admin:integrationDiscover:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!rl.success) return rateLimitResponse(rl)
    const { id } = await params
    const db = supabaseAdmin()
    const { data: integration } = await db.from('integrations').select('id, account_id, kind, config, secrets').eq('id', id).eq('account_id', ctx.accountId).maybeSingle()
    if (!integration) return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    if (integration.kind !== 'mcp') return NextResponse.json({ error: 'Only MCP servers list their own tools.' }, { status: 400 })
    try {
      const summary = await rediscoverMcp(db, integration)
      const { data: tools } = await db.from('integration_tools').select(TOOL_PUBLIC_COLUMNS).eq('integration_id', id).order('name')
      return NextResponse.json({ ...summary, tools: tools ?? [] })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error'
      await db.from('integrations').update({ status: 'error', last_error: msg.slice(0, 300), last_error_at: new Date().toISOString() }).eq('id', id)
      return NextResponse.json({ error: `Could not connect: ${msg}` }, { status: 400 })
    }
  } catch (err) {
    return integrationError(err, 'POST /api/integrations/:id/discover')
  }
}
