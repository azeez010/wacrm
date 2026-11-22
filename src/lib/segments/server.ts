import type { SupabaseClient } from '@supabase/supabase-js'
import { assertFeature, FeatureLockedError } from '@/lib/billing/entitlements'
import { FILTER_VERSION, type FilterGroup, type Segment } from './types'
import { parseFilter } from './validate'

// ============================================================
// Server-side segment operations, shared by the public API and MCP.
// Callers pass a service-role client plus the verified account id; every
// query is scoped by account_id explicitly (the service role bypasses RLS).
// ============================================================

export type SegResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }
const ok = <T>(data: T): SegResult<T> => ({ ok: true, data })
const fail = (status: number, error: string): SegResult<never> => ({ ok: false, status, error })

export interface SegCtx {
  db: SupabaseClient
  accountId: string
  userId?: string | null
}

async function gate<T>(ctx: SegCtx, fn: () => Promise<SegResult<T>>): Promise<SegResult<T>> {
  try {
    await assertFeature(ctx.db, ctx.accountId, 'custom_fields')
    return await fn()
  } catch (err) {
    if (err instanceof FeatureLockedError) return fail(402, err.message)
    throw err
  }
}

export const listSegments = (ctx: SegCtx) =>
  gate(ctx, async () => {
    const { data, error } = await ctx.db
      .from('segments')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('name')
    if (error) return fail(500, error.message)
    return ok((data ?? []) as Segment[])
  })

export const getSegment = (ctx: SegCtx, id: string) =>
  gate(ctx, async () => {
    const { data } = await ctx.db
      .from('segments')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    return data ? ok(data as Segment) : fail(404, 'Segment not found')
  })

export const createSegment = (
  ctx: SegCtx,
  input: { name?: unknown; description?: unknown; filter?: unknown; source?: unknown; locked?: unknown },
) =>
  gate(ctx, async () => {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name || name.length > 80) return fail(400, "'name' is required (max 80 chars)")
    const parsed = parseFilter(input.filter)
    if (!parsed.ok) return fail(400, parsed.error)
    const { data, error } = await ctx.db
      .from('segments')
      .insert({
        account_id: ctx.accountId,
        name,
        description: typeof input.description === 'string' ? input.description.trim() || null : null,
        filter: parsed.filter,
        source: typeof input.source === 'string' ? input.source : null,
        locked: input.locked === true,
        created_by: ctx.userId ?? null,
      })
      .select()
      .single()
    if (error) {
      return error.code === '23505' ? fail(409, `A segment named "${name}" already exists`) : fail(500, error.message)
    }
    return ok(data as Segment)
  })

export const updateSegment = (
  ctx: SegCtx,
  id: string,
  patch: { name?: unknown; description?: unknown; filter?: unknown },
) =>
  gate(ctx, async () => {
    const { data: current } = await ctx.db
      .from('segments')
      .select('id, locked')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!current) return fail(404, 'Segment not found')
    if ((current as { locked: boolean }).locked) return fail(403, 'This segment is managed by an app')

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (patch.name !== undefined) {
      const name = typeof patch.name === 'string' ? patch.name.trim() : ''
      if (!name || name.length > 80) return fail(400, "'name' must be 1-80 characters")
      update.name = name
    }
    if (patch.description !== undefined) {
      update.description = typeof patch.description === 'string' ? patch.description.trim() || null : null
    }
    if (patch.filter !== undefined) {
      const parsed = parseFilter(patch.filter)
      if (!parsed.ok) return fail(400, parsed.error)
      update.filter = parsed.filter
    }
    const { data, error } = await ctx.db
      .from('segments')
      .update(update)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select()
      .single()
    if (error) {
      return error.code === '23505' ? fail(409, 'A segment with that name already exists') : fail(500, error.message)
    }
    return ok(data as Segment)
  })

export const deleteSegment = (ctx: SegCtx, id: string) =>
  gate(ctx, async () => {
    const { data: current } = await ctx.db
      .from('segments')
      .select('id, locked')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!current) return fail(404, 'Segment not found')
    if ((current as { locked: boolean }).locked) return fail(403, 'This segment is managed by an app')
    const { error } = await ctx.db.from('segments').delete().eq('id', id).eq('account_id', ctx.accountId)
    if (error) return fail(500, error.message)
    return ok({ deleted: true as const })
  })

export interface FilteredContacts {
  contacts: Record<string, unknown>[]
  total: number
}

/** One page of contacts matching a filter (ad hoc or a segment's), with the total. */
export const filterContacts = (
  ctx: SegCtx,
  filter: FilterGroup | unknown,
  opts: { search?: string; limit?: number; offset?: number } = {},
) =>
  gate(ctx, async () => {
    const parsed = parseFilter(filter)
    if (!parsed.ok) return fail(400, parsed.error)
    const { data, error } = await ctx.db.rpc('filter_contacts', {
      p_filter: parsed.filter,
      p_search: opts.search ?? null,
      p_limit: Math.min(Math.max(opts.limit ?? 50, 1), 100),
      p_offset: Math.max(opts.offset ?? 0, 0),
      p_sort_field: null,
      p_sort_dir: 'desc',
      p_account_id: ctx.accountId,
    })
    if (error) return fail(500, error.message)
    const rows = (data ?? []) as { contact: Record<string, unknown>; total_count: number }[]
    return ok({
      contacts: rows.map((r) => r.contact),
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,
    } satisfies FilteredContacts)
  })

export const countFilter = (ctx: SegCtx, filter: FilterGroup | unknown) =>
  gate(ctx, async () => {
    const parsed = parseFilter(filter)
    if (!parsed.ok) return fail(400, parsed.error)
    const { data, error } = await ctx.db.rpc('count_contacts', {
      p_filter: parsed.filter,
      p_search: null,
      p_account_id: ctx.accountId,
    })
    if (error) return fail(500, error.message)
    return ok({ count: Number(data ?? 0) })
  })

export const EMPTY_FILTER_GROUP: FilterGroup = { version: FILTER_VERSION, op: 'and', rules: [] }

/** SegCtx from a verified API key context (service-role client + account). */
export function segCtxFromKey(ctx: { supabase: SupabaseClient; accountId: string; createdBy?: string | null }): SegCtx {
  return { db: ctx.supabase, accountId: ctx.accountId, userId: ctx.createdBy ?? null }
}
