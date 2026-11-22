import { NextResponse } from 'next/server'
import { countRecordUsage, deleteRecord, getTable, updateRecord } from '@/lib/custom-fields/server'
import { badJson, isResponse, readJson, resolveCtx, respond } from '@/lib/custom-fields/route-helpers'

type P = { params: Promise<{ id: string; recordId: string }> }

// GET returns how many contacts reference the row (used by the delete warning).
export async function GET(_request: Request, { params }: P) {
  const { id, recordId } = await params
  const ctx = await resolveCtx()
  if (isResponse(ctx)) return ctx
  const found = await getTable(ctx, id)
  if (!found.ok) return respond(found, 'error')
  const used_by_contacts = await countRecordUsage(ctx, found.data.table, recordId)
  return NextResponse.json({ used_by_contacts })
}

export async function PATCH(request: Request, { params }: P) {
  const { id, recordId } = await params
  const ctx = await resolveCtx('agent')
  if (isResponse(ctx)) return ctx
  const body = await readJson(request)
  if (!body) return badJson()
  const values = (body.values && typeof body.values === 'object' ? body.values : body) as Record<string, unknown>
  return respond(await updateRecord(ctx, id, recordId, values), 'record')
}

export async function DELETE(_request: Request, { params }: P) {
  const { id, recordId } = await params
  const ctx = await resolveCtx('agent')
  if (isResponse(ctx)) return ctx
  const res = await deleteRecord(ctx, id, recordId)
  return res.ok ? NextResponse.json(res.data) : respond(res, 'error')
}
