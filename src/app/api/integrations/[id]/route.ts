// /api/integrations/[id] - PATCH (rename, pause, change URL / token / headers / key) and DELETE. Admins only.

import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { INTEGRATION_PUBLIC_COLUMNS, firstIssue, prepareUpdate, updateSchema, type IntegrationKind } from '@/lib/integrations/manage'
import { integrationError, readJson } from '@/lib/integrations/http'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const body = await readJson(request)
    if (!body) return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })

    const db = supabaseAdmin()
    const { data: current } = await db.from('integrations').select('id, kind, config, secrets').eq('id', id).eq('account_id', ctx.accountId).maybeSingle()
    if (!current) return NextResponse.json({ error: 'Integration not found' }, { status: 404 })

    const patch = await prepareUpdate(current as { kind: IntegrationKind; config: Record<string, unknown>; secrets: string | null }, parsed.data)
    const { data, error } = await db.from('integrations').update(patch).eq('id', id).eq('account_id', ctx.accountId).select(INTEGRATION_PUBLIC_COLUMNS).single()
    if (error) {
      console.error('[PATCH /api/integrations/:id]', error)
      return NextResponse.json({ error: 'Could not save the integration' }, { status: 500 })
    }
    return NextResponse.json({ integration: data })
  } catch (err) {
    return integrationError(err, 'PATCH /api/integrations/:id')
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const db = supabaseAdmin()
    const { data, error } = await db.from('integrations').delete().eq('id', id).eq('account_id', ctx.accountId).select('id')
    if (error) {
      console.error('[DELETE /api/integrations/:id]', error)
      return NextResponse.json({ error: 'Could not remove the integration' }, { status: 500 })
    }
    if (!data?.length) return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return integrationError(err, 'DELETE /api/integrations/:id')
  }
}
