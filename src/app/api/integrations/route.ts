// ============================================================
// /api/integrations (dashboard, cookie session) - Settings → Integrations
//
//   GET  - this workspace's integrations with their tools, plus plan usage. Secrets are never returned (hints only).
//   POST - connect one (admins). The connection is checked first: MCP handshake + tool discovery, Paystack key test.
// ============================================================

import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole } from '@/lib/auth/account'
import { getEntitlements } from '@/lib/billing/entitlements'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  INTEGRATION_PUBLIC_COLUMNS,
  TOOL_PUBLIC_COLUMNS,
  assertCanAddIntegration,
  createSchema,
  firstIssue,
  insertTools,
  prepareCreate,
} from '@/lib/integrations/manage'
import { integrationError, readJson } from '@/lib/integrations/http'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const [ints, tools, ent] = await Promise.all([
      ctx.supabase.from('integrations').select(INTEGRATION_PUBLIC_COLUMNS).eq('account_id', ctx.accountId).order('created_at'),
      ctx.supabase.from('integration_tools').select(TOOL_PUBLIC_COLUMNS).eq('account_id', ctx.accountId).order('name'),
      getEntitlements(ctx.supabase, ctx.accountId),
    ])
    if (ints.error || tools.error) {
      console.error('[GET /api/integrations]', ints.error ?? tools.error)
      return NextResponse.json({ error: 'Could not load integrations' }, { status: 500 })
    }
    const byIntegration = new Map<string, unknown[]>()
    for (const t of tools.data ?? []) {
      const list = byIntegration.get(t.integration_id as string) ?? []
      list.push(t)
      byIntegration.set(t.integration_id as string, list)
    }
    const limit = ent.limits.integrations_max
    return NextResponse.json({
      integrations: (ints.data ?? []).map((i) => ({ ...i, tools: byIntegration.get(i.id as string) ?? [] })),
      usage: {
        used: ints.data?.length ?? 0,
        limit: typeof limit === 'number' ? limit : null,
        enabled: ent.features.ai_tools === true,
        plan: ent.planName,
      },
    })
  } catch (err) {
    return integrationError(err, 'GET /api/integrations')
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const rl = checkRateLimit(`admin:integrationCreate:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!rl.success) return rateLimitResponse(rl)

    const body = await readJson(request)
    if (!body) return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    if (body.kind === 'google_calendar') {
      return NextResponse.json({ error: 'Use "Connect with Google" to add Google Calendar.' }, { status: 400 })
    }
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })

    const db = supabaseAdmin()
    await assertCanAddIntegration(db, ctx.accountId)
    const prepared = await prepareCreate(parsed.data)

    const { data: row, error } = await db
      .from('integrations')
      .insert({ ...prepared.row, account_id: ctx.accountId, created_by: ctx.userId, status: 'connected', last_ok_at: new Date().toISOString() })
      .select(INTEGRATION_PUBLIC_COLUMNS)
      .single()
    if (error || !row) {
      console.error('[POST /api/integrations] insert', error)
      return NextResponse.json({ error: 'Could not save the integration' }, { status: 500 })
    }
    try {
      await insertTools(db, ctx.accountId, row.id as string, prepared.tools)
    } catch (e) {
      await db.from('integrations').delete().eq('id', row.id)
      throw e
    }
    const { data: tools } = await db.from('integration_tools').select(TOOL_PUBLIC_COLUMNS).eq('integration_id', row.id).order('name')
    return NextResponse.json({ integration: { ...row, tools: tools ?? [] } }, { status: 201 })
  } catch (err) {
    return integrationError(err, 'POST /api/integrations')
  }
}
