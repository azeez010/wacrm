import { NextResponse } from 'next/server'
import { deleteTable, getTable, updateTable } from '@/lib/custom-fields/server'
import { badJson, isResponse, readJson, resolveCtx, respond } from '@/lib/custom-fields/route-helpers'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveCtx()
  if (isResponse(ctx)) return ctx
  const res = await getTable(ctx, id)
  return res.ok ? NextResponse.json(res.data) : respond(res, 'error')
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveCtx('admin')
  if (isResponse(ctx)) return ctx
  const body = await readJson(request)
  if (!body) return badJson()
  return respond(await updateTable(ctx, id, body), 'table')
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveCtx('admin')
  if (isResponse(ctx)) return ctx
  const res = await deleteTable(ctx, id)
  return res.ok ? NextResponse.json(res.data) : respond(res, 'error')
}
