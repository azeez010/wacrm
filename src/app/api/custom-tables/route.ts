import { NextResponse } from 'next/server'
import { createTable, listTables } from '@/lib/custom-fields/server'
import { badJson, isResponse, readJson, resolveCtx, respond } from '@/lib/custom-fields/route-helpers'

// Custom tables. GET: any member. POST: admin (shape + columns in one call).

export async function GET() {
  const ctx = await resolveCtx()
  if (isResponse(ctx)) return ctx
  return respond(await listTables(ctx), 'tables')
}

export async function POST(request: Request) {
  const ctx = await resolveCtx('admin')
  if (isResponse(ctx)) return ctx
  const body = await readJson(request)
  if (!body) return badJson()
  const res = await createTable(ctx, body)
  return res.ok ? NextResponse.json(res.data, { status: 201 }) : respond(res, 'table')
}
