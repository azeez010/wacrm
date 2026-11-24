import { arrayMove } from '@dnd-kit/sortable'

import { sanitizeConditions } from '@/lib/forms/conditions'
import { parseFormSettings, type FormField, type FormSettings } from '@/lib/forms/types'

// Editor state for a form being edited. Pure reducer so it is easy to test.

export interface EditorState {
  name: string
  status: 'draft' | 'active' | 'paused'
  fields: FormField[]
  settings: FormSettings
  /** Last saved snapshot, to know when there is something to save. */
  saved: string
}

export type EditorAction =
  | { type: 'load'; name: string; status: EditorState['status']; fields: FormField[]; settings: FormSettings }
  | { type: 'name'; name: string }
  | { type: 'status'; status: EditorState['status'] }
  | { type: 'add'; field: FormField; at?: number }
  | { type: 'update'; id: string; patch: Partial<FormField> }
  | { type: 'remove'; id: string }
  | { type: 'move'; from: number; to: number }
  | { type: 'settings'; patch: Record<string, unknown> }
  | { type: 'markSaved' }

const snapshot = (s: Pick<EditorState, 'name' | 'status' | 'fields' | 'settings'>) =>
  JSON.stringify([s.name, s.status, s.fields, s.settings])

/** Shallow-merge a patch into settings, merging one level of nested objects. */
export function mergeSettings(current: FormSettings, patch: Record<string, unknown>): FormSettings {
  const next: Record<string, unknown> = { ...current }
  for (const [k, v] of Object.entries(patch)) {
    const cur = (current as Record<string, unknown>)[k]
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      next[k] = { ...(cur as object), ...(v as object) }
    } else if (v === undefined) {
      delete next[k]
    } else {
      next[k] = v
    }
  }
  return keepTyping(parseFormSettings(next), next)
}

/**
 * The schema trims text, which would eat every space as the owner types ("Hi," + space
 * becomes "Hi,"). Keep what was typed while editing; the server trims on save.
 */
function keepTyping<T>(parsed: T, raw: unknown): T {
  if (!parsed || typeof parsed !== 'object' || !raw || typeof raw !== 'object') return parsed
  const out = { ...(parsed as Record<string, unknown>) }
  for (const [k, r] of Object.entries(raw as Record<string, unknown>)) {
    const p = out[k]
    if (typeof r === 'string' && typeof p === 'string' && p === r.trim()) out[k] = r
    else if (r && typeof r === 'object' && !Array.isArray(r)) out[k] = keepTyping(p, r)
  }
  return out as T
}

/** A short, unique field id. */
export function newFieldId(existing: FormField[], prefix: string): string {
  const used = new Set(existing.map((f) => f.id))
  if (!used.has(prefix)) return prefix
  for (let i = 2; i < 1000; i++) if (!used.has(`${prefix}_${i}`)) return `${prefix}_${i}`
  return `${prefix}_${Date.now().toString(36)}`
}

export function initialState(): EditorState {
  return { name: '', status: 'draft', fields: [], settings: parseFormSettings({}), saved: '' }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'load': {
      const s = { name: action.name, status: action.status, fields: action.fields, settings: action.settings }
      return { ...s, saved: snapshot(s) }
    }
    case 'name':
      return { ...state, name: action.name }
    case 'status':
      return { ...state, status: action.status }
    case 'add': {
      const field = { ...action.field, id: newFieldId(state.fields, action.field.id) }
      const fields = [...state.fields]
      fields.splice(action.at ?? fields.length, 0, field)
      return { ...state, fields }
    }
    case 'update':
      return {
        ...state,
        // The phone field is locked: always required, never removed or retyped.
        fields: state.fields.map((f) =>
          f.id === action.id ? { ...f, ...action.patch, ...(f.kind === 'phone' ? { kind: 'phone' as const, required: true } : {}) } : f,
        ),
      }
    case 'remove':
      // Rules that pointed at the removed field are dropped so the form stays valid.
      return { ...state, fields: sanitizeConditions(state.fields.filter((f) => f.id !== action.id || f.kind === 'phone')) }
    case 'move': {
      if (action.from === action.to || action.from < 0 || action.to < 0) return state
      if (action.from >= state.fields.length || action.to >= state.fields.length) return state
      // A rule must point at an EARLIER field; moving can break that, so drop dead rules.
      return { ...state, fields: sanitizeConditions(arrayMove(state.fields, action.from, action.to)) }
    }
    case 'settings':
      return { ...state, settings: mergeSettings(state.settings, action.patch) }
    case 'markSaved':
      return { ...state, saved: snapshot(state) }
  }
}

export const isDirty = (s: EditorState) => s.saved !== snapshot(s)
