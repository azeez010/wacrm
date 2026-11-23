// A small in-memory stand-in for the Supabase query builder, for unit tests that
// would otherwise need a long chain of hand-written mocks. It supports the calls
// the app's server code makes: select / insert / update / delete, the common
// filters, order / limit / range, maybeSingle / single, head counts and rpc.

import type { SupabaseClient } from '@supabase/supabase-js'

export type Row = Record<string, unknown>

export interface FakeDbOptions {
  /** Return true to make an insert fail with a unique violation (23505). */
  isDuplicate?: (table: string, row: Row, existing: Row[]) => boolean
  rpc?: Record<string, (args: Record<string, unknown>, db: FakeDb) => unknown>
}

export class FakeDb {
  tables: Record<string, Row[]> = {}
  constructor(private opts: FakeDbOptions = {}, seed: Record<string, Row[]> = {}) {
    for (const [t, rows] of Object.entries(seed)) this.tables[t] = rows.map((r) => ({ ...r }))
  }
  rows(table: string): Row[] {
    return (this.tables[table] ??= [])
  }
  from(table: string) {
    return new Builder(this, table, this.opts)
  }
  async rpc(name: string, args: Record<string, unknown>) {
    const fn = this.opts.rpc?.[name]
    if (!fn) throw new Error(`FakeDb: no rpc handler for ${name}`)
    return { data: fn(args, this), error: null }
  }
  asClient(): SupabaseClient {
    return this as unknown as SupabaseClient
  }
}

class Builder {
  private filters: Array<(r: Row) => boolean> = []
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  private upsertRows: Row[] = []
  private conflictKeys: string[] = []
  private payload: Row = {}
  private wantOne = false
  private headCount = false
  private orderKey: string | null = null
  private asc = true
  private limitN: number | null = null
  private from_: number | null = null
  private to_: number | null = null
  constructor(private db: FakeDb, private table: string, private opts: FakeDbOptions) {}

  select(_cols?: string, o?: { count?: string; head?: boolean }) {
    if (o?.head) this.headCount = true
    return this
  }
  insert(p: Row) { this.op = 'insert'; this.payload = p; return this }
  upsert(p: Row | Row[], o?: { onConflict?: string }) {
    this.op = 'upsert'
    this.upsertRows = Array.isArray(p) ? p : [p]
    this.conflictKeys = (o?.onConflict ?? 'id').split(',').map((k) => k.trim())
    return this
  }
  update(p: Row) { this.op = 'update'; this.payload = p; return this }
  delete() { this.op = 'delete'; return this }
  eq(k: string, v: unknown) { this.filters.push((r) => r[k] === v); return this }
  neq(k: string, v: unknown) { this.filters.push((r) => r[k] !== v); return this }
  is(k: string, v: unknown) { this.filters.push((r) => (r[k] ?? null) === v); return this }
  in(k: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[k])); return this }
  gte(k: string, v: string) { this.filters.push((r) => (r[k] as string) >= v); return this }
  lt(k: string, v: string) { this.filters.push((r) => r[k] != null && (r[k] as string) < v); return this }
  ilike(k: string, v: string) {
    this.filters.push((r) => String(r[k] ?? '').toLowerCase() === v.replace(/\\/g, '').toLowerCase())
    return this
  }
  order(k: string, o?: { ascending?: boolean }) { this.orderKey = k; this.asc = o?.ascending !== false; return this }
  limit(n: number) { this.limitN = n; return this }
  range(a: number, b: number) { this.from_ = a; this.to_ = b; return this }
  maybeSingle() { this.wantOne = true; return this.exec() }
  single() { this.wantOne = true; return this.exec() }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then(res: any, rej: any) { return this.exec().then(res, rej) }

  private async exec() {
    const rows = this.db.rows(this.table)
    if (this.op === 'insert') {
      if (this.opts.isDuplicate?.(this.table, this.payload, rows)) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
      }
      const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...this.payload }
      rows.push(row)
      return { data: this.wantOne ? row : [row], error: null }
    }
    if (this.op === 'upsert') {
      for (const row of this.upsertRows) {
        const hit = rows.find((r) => this.conflictKeys.every((k) => r[k] === row[k]))
        if (hit) Object.assign(hit, row)
        else rows.push({ ...row })
      }
      return { data: null, error: null }
    }
    let matched = rows.filter((r) => this.filters.every((f) => f(r)))
    if (this.op === 'update') {
      matched.forEach((r) => Object.assign(r, this.payload))
      return { data: null, error: null }
    }
    if (this.op === 'delete') {
      this.db.tables[this.table] = rows.filter((r) => !matched.includes(r))
      return { data: null, error: null }
    }
    if (this.orderKey) {
      const k = this.orderKey
      matched = [...matched].sort((a, b) => ((a[k] as string) < (b[k] as string) ? -1 : 1) * (this.asc ? 1 : -1))
    }
    if (this.from_ != null) matched = matched.slice(this.from_, (this.to_ ?? matched.length) + 1)
    if (this.limitN != null) matched = matched.slice(0, this.limitN)
    if (this.headCount) return { data: null, count: matched.length, error: null }
    return { data: this.wantOne ? (matched[0] ?? null) : matched, error: null }
  }
}
