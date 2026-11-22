import { NextResponse } from 'next/server'
import { createRecord, listRecords } from '@/lib/custom-fields/server'
import { badJson, isResponse, readJson, resolveCtx, respond } from '@/lib/custom-fields/route-helpers'

// Rows of a custom table. GET: any member (search + paging). POST: agent+
// (further limited by the table's min_role_edit).

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveCtx()
  if (isResponse(ctx)) return ctx
  const url = new URL(request.url)
  const res = await listRecords(ctx, id, {
    search: url.searchParams.get('search') ?? undefined,
    limit: Number(url.searchParams.get('limit')) || undefined,
    offset: Number(url.searchParams.get('offset')) || undefined,
    ids: url.searchParams.get('ids')?.split(',').filter(Boolean),
  })
  return res.ok ? NextResponse.json(res.data) : respond(res, 'error')
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveCtx('agent')
  if (isResponse(ctx)) return ctx
  const body = await readJson(request)
  if (!body) return badJson()
  const values = (body.values && typeof body.values === 'object' ? body.values : body) as Record<string, unknown>
  const res = await createRecord(ctx, id, values)
  return res.ok ? NextResponse.json({ record: res.data }, { status: 201 }) : respond(res, 'record')
}
