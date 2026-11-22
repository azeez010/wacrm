import { NextResponse } from 'next/server'
import { createField, listFields } from '@/lib/custom-fields/server'
import { badJson, isResponse, readJson, resolveCtx, respond } from '@/lib/custom-fields/route-helpers'

// Contact custom field definitions. GET: any member. POST: admin.

export async function GET(request: Request) {
  const ctx = await resolveCtx()
  if (isResponse(ctx)) return ctx
  const url = new URL(request.url)
  const tableId = url.searchParams.get('table_id')
  const res = await listFields(ctx, {
    tableId,
    includeArchived: url.searchParams.get('include_archived') === '1',
  })
  return respond(res, 'fields')
}

export async function POST(request: Request) {
  const ctx = await resolveCtx('admin')
  if (isResponse(ctx)) return ctx
  const body = await readJson(request)
  if (!body) return badJson()
  const res = await createField(ctx, body)
  return res.ok ? NextResponse.json({ field: res.data }, { status: 201 }) : respond(res, 'field')
}
