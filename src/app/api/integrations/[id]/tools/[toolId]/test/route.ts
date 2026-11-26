// /api/integrations/[id]/tools/[toolId]/test - POST { arguments }: run one tool now, as the admin, and show the result.
// Actions really run (the admin pressed "Run"), so the call is logged like any other.

import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { executeIntegrationTool, redact, type IntegrationRow, type ToolRow } from '@/lib/ai/tools/registry'
import { capOutput } from '@/lib/ai/tools/types'
import { integrationError, readJson } from '@/lib/integrations/http'

export async function POST(request: Request, { params }: { params: Promise<{ id: string; toolId: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const rl = checkRateLimit(`admin:integrationTest:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!rl.success) return rateLimitResponse(rl)
    const { id, toolId } = await params
    const body = (await readJson(request)) ?? {}
    const args = body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments) ? (body.arguments as Record<string, unknown>) : {}

    const db = supabaseAdmin()
    const [{ data: integration }, { data: tool }] = await Promise.all([
      db.from('integrations').select('id, kind, name, status, config, secrets').eq('id', id).eq('account_id', ctx.accountId).maybeSingle(),
      db.from('integration_tools').select('id, integration_id, name, title, description, input_schema, kind, enabled, auto_approve, config').eq('id', toolId).eq('integration_id', id).maybeSingle(),
    ])
    if (!integration || !tool) return NextResponse.json({ error: 'Tool not found' }, { status: 404 })

    const started = Date.now()
    let out: { text: string; isError: boolean }
    try {
      out = await executeIntegrationTool(db, integration as IntegrationRow, tool as ToolRow, args)
    } catch (e) {
      out = { text: e instanceof Error ? e.message : 'The tool could not be reached.', isError: true }
    }
    const text = capOutput(out.text)
    const ms = Date.now() - started
    await db.from('ai_tool_calls').insert({
      account_id: ctx.accountId, tool_id: tool.id, integration_id: integration.id, tool_name: `${integration.name} · ${tool.title || tool.name}`,
      mode: 'manual', kind: tool.kind, arguments: redact(args), status: out.isError ? 'error' : 'ok', result: text.slice(0, 2000),
      error: out.isError ? text.slice(0, 300) : null, duration_ms: ms, decided_by: ctx.userId, decided_at: new Date().toISOString(), summary: 'Test run from Settings',
    })
    await db.from('integrations').update(out.isError ? { last_error_at: new Date().toISOString(), last_error: text.slice(0, 300) } : { last_ok_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ ok: !out.isError, result: text, durationMs: ms })
  } catch (err) {
    return integrationError(err, 'POST /api/integrations/:id/tools/:toolId/test')
  }
}
