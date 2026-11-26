// /api/integrations/[id]/tools/[toolId]
//   PATCH  - on/off, read vs action, "allow without approval", description; for custom HTTP actions also the full
//            definition (`definition`). Admins.
//   DELETE - remove a custom HTTP action (discovered / built-in tools are switched off instead). Admins.

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRole } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { assertPublicHttps } from '@/lib/ai/tools/guarded-fetch'
import { TOOL_PUBLIC_COLUMNS, firstIssue, httpToolRow, httpToolSchema, toolPatchSchema } from '@/lib/integrations/manage'
import { integrationError, readJson } from '@/lib/integrations/http'

type Params = { params: Promise<{ id: string; toolId: string }> }
const patchSchema = toolPatchSchema.extend({ definition: httpToolSchema.optional() })

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const { id, toolId } = await params
    const body = await readJson(request)
    if (!body) return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error as z.ZodError) }, { status: 400 })

    const db = supabaseAdmin()
    const { data: tool } = await db.from('integration_tools').select('id, kind, source, auto_approve').eq('id', toolId).eq('integration_id', id).eq('account_id', ctx.accountId).maybeSingle()
    if (!tool) return NextResponse.json({ error: 'Tool not found' }, { status: 404 })

    const { definition, ...rest } = parsed.data
    const patch: Record<string, unknown> = { ...rest }
    if (definition) {
      if (tool.source !== 'defined') return NextResponse.json({ error: 'Only custom actions can be edited.' }, { status: 400 })
      await assertPublicHttps(definition.url)
      const { data: integration } = await db.from('integrations').select('config').eq('id', id).maybeSingle()
      const headerNames = Array.isArray(integration?.config?.header_names) ? (integration!.config.header_names as string[]) : []
      const row = httpToolRow(definition, headerNames)
      Object.assign(patch, { name: row.name, title: row.title, description: row.description, input_schema: row.input_schema, kind: row.kind, config: row.config })
    }
    // "Allow without approval" only means something for actions.
    if ((patch.kind ?? tool.kind) === 'read') patch.auto_approve = false

    const { data, error } = await db.from('integration_tools').update(patch).eq('id', toolId).select(TOOL_PUBLIC_COLUMNS).single()
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'An action with that name already exists.' }, { status: 409 })
      console.error('[PATCH tool]', error)
      return NextResponse.json({ error: 'Could not save the tool' }, { status: 500 })
    }
    return NextResponse.json({ tool: data })
  } catch (err) {
    return integrationError(err, 'PATCH /api/integrations/:id/tools/:toolId')
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const { id, toolId } = await params
    const db = supabaseAdmin()
    const { data: tool } = await db.from('integration_tools').select('id, source').eq('id', toolId).eq('integration_id', id).eq('account_id', ctx.accountId).maybeSingle()
    if (!tool) return NextResponse.json({ error: 'Tool not found' }, { status: 404 })
    if (tool.source !== 'defined') return NextResponse.json({ error: 'Switch this tool off instead.' }, { status: 400 })
    await db.from('integration_tools').delete().eq('id', toolId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return integrationError(err, 'DELETE /api/integrations/:id/tools/:toolId')
  }
}
