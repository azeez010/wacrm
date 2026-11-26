// /api/integrations/[id]/tools - POST: add a custom HTTP action to an HTTP integration. Admins.

import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { assertPublicHttps } from '@/lib/ai/tools/guarded-fetch'
import { TOOL_PUBLIC_COLUMNS, firstIssue, httpToolRow, httpToolSchema } from '@/lib/integrations/manage'
import { integrationError, readJson } from '@/lib/integrations/http'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const body = await readJson(request)
    if (!body) return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    const parsed = httpToolSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })

    const db = supabaseAdmin()
    const { data: integration } = await db.from('integrations').select('id, kind, config').eq('id', id).eq('account_id', ctx.accountId).maybeSingle()
    if (!integration) return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    if (integration.kind !== 'http') return NextResponse.json({ error: 'Actions can only be added to an HTTP integration.' }, { status: 400 })
    await assertPublicHttps(parsed.data.url)

    const headerNames = Array.isArray(integration.config?.header_names) ? (integration.config.header_names as string[]) : []
    const { data, error } = await db
      .from('integration_tools')
      .insert({ ...httpToolRow(parsed.data, headerNames), account_id: ctx.accountId, integration_id: id })
      .select(TOOL_PUBLIC_COLUMNS)
      .single()
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'An action with that name already exists.' }, { status: 409 })
      console.error('[POST /api/integrations/:id/tools]', error)
      return NextResponse.json({ error: 'Could not save the action' }, { status: 500 })
    }
    return NextResponse.json({ tool: data }, { status: 201 })
  } catch (err) {
    return integrationError(err, 'POST /api/integrations/:id/tools')
  }
}
