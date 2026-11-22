import type { PreparedRow, SystemField } from './import-mapping'

// ============================================================
// Custom-table columns on import (profile.name, profile.age ...): resolve
// each distinct table row once, by its label, through the bulk route.
// ============================================================

export interface TableRowOutcome {
  id: string | null
  created: boolean
  error?: string
}

export interface TableResolution {
  /** `${contactFieldId}|${label lower-cased}` -> outcome */
  byKey: Map<string, TableRowOutcome>
  createdCount: number
  /** Contact fields whose table columns were mapped without the label column. */
  missingLabel: Set<string>
}

export const tableRowKey = (fieldId: string, label: string) => `${fieldId}|${label.trim().toLowerCase()}`

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

/**
 * `tableKeyByFieldId`: the custom table each reference field points at.
 * Only rows that will actually be imported should be passed in.
 */
export async function resolveTableGroups(args: {
  rows: PreparedRow[]
  fields: SystemField[]
  tableKeyByFieldId: Record<string, string>
  createMissing: boolean
  fetchImpl?: FetchLike
  onProgress?: (done: number, total: number) => void
}): Promise<TableResolution> {
  const { rows, fields, tableKeyByFieldId, createMissing } = args
  const doFetch: FetchLike = args.fetchImpl ?? ((url, init) => fetch(url, init))
  const result: TableResolution = { byKey: new Map(), createdCount: 0, missingLabel: new Set() }

  const labelKeyByField = new Map<string, string>()
  const mappedFields = new Set<string>()
  for (const f of fields) {
    if (f.group !== 'table' || !f.refFieldId || !f.columnKey) continue
    if (f.isLabel) labelKeyByField.set(f.refFieldId, f.columnKey)
  }
  for (const r of rows) for (const fid of Object.keys(r.tables)) mappedFields.add(fid)

  for (const fieldId of mappedFields) {
    const labelKey = labelKeyByField.get(fieldId)
    const tableKey = tableKeyByFieldId[fieldId]
    if (!labelKey || !tableKey) {
      result.missingLabel.add(fieldId)
      continue
    }
    // One entry per distinct label (the first row's other columns are used).
    const distinct = new Map<string, Record<string, string>>()
    for (const r of rows) {
      const values = r.tables[fieldId]
      const label = values?.[labelKey]
      if (!values || !label) continue
      const k = label.trim().toLowerCase()
      if (!distinct.has(k)) distinct.set(k, values)
    }
    const entries = [...distinct.entries()]
    for (let i = 0; i < entries.length; i += 200) {
      const part = entries.slice(i, i + 200)
      let outcomes: { label: string; id: string | null; created: boolean; error?: string }[] = []
      let failure: string | null = null
      try {
        const res = await doFetch(`/api/custom-tables/${encodeURIComponent(tableKey)}/records/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: part.map(([, values]) => ({ values })), create_missing: createMissing }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          results?: typeof outcomes
          error?: string
        }
        if (res.ok && Array.isArray(data.results)) outcomes = data.results
        else failure = data.error ?? 'Could not resolve table rows'
      } catch {
        failure = 'Could not reach the server'
      }
      part.forEach(([k], j) => {
        const o = outcomes[j]
        const outcome: TableRowOutcome = failure
          ? { id: null, created: false, error: failure }
          : { id: o?.id ?? null, created: !!o?.created, error: o?.error }
        if (outcome.created) result.createdCount++
        result.byKey.set(`${fieldId}|${k}`, outcome)
      })
      args.onProgress?.(Math.min(i + 200, entries.length), entries.length)
    }
  }
  return result
}
