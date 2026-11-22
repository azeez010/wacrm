import { NextResponse } from 'next/server'
import { bulkResolveRecords } from '@/lib/custom-fields/server'
import { badJson, isResponse, readJson, resolveCtx, respond } from '@/lib/custom-fields/route-helpers'

// POST /api/custom-tables/{id|key}/records/bulk (agent+)
// Body: { rows: [{ values: { column_key: value } }], create_missing?: boolean }
// Finds each row by its label (reusing it untouched) or creates it, and returns
// the row id per input row. Used by the contacts import for table columns.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveCtx('agent')
  if (isResponse(ctx)) return ctx
  const body = await readJson(request)
  if (!body || !Array.isArray(body.rows)) return badJson()
  const rows = (body.rows as unknown[]).map((r) =>
    r && typeof r === 'object' && 'values' in (r as object)
      ? (((r as { values: unknown }).values ?? {}) as Record<string, unknown>)
      : ((r ?? {}) as Record<string, unknown>),
  )
  const res = await bulkResolveRecords(ctx, id, rows, { createMissing: body.create_missing === true })
  return res.ok ? NextResponse.json(res.data) : respond(res, 'error')
}
