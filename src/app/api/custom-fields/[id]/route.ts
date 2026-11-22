import { NextResponse } from 'next/server'
import { deleteField, updateField } from '@/lib/custom-fields/server'
import { badJson, isResponse, readJson, resolveCtx, respond } from '@/lib/custom-fields/route-helpers'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveCtx('admin')
  if (isResponse(ctx)) return ctx
  const body = await readJson(request)
  if (!body) return badJson()
  return respond(await updateField(ctx, id, body), 'field')
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveCtx('admin')
  if (isResponse(ctx)) return ctx
  const purge = new URL(request.url).searchParams.get('purge') === '1'
  const res = await deleteField(ctx, id, { purge })
  return res.ok ? NextResponse.json(res.data) : respond(res, 'error')
}
