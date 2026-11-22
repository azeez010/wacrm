import { describe, expect, it } from 'vitest'

import { parseFormSettings, type FormField } from '@/lib/forms/types'
import { editorReducer, initialState, isDirty, mergeSettings, newFieldId, type EditorState } from './editor-state'

const phone: FormField = { id: 'phone', kind: 'phone', required: true }
const name: FormField = { id: 'name', kind: 'name' }
const load = (): EditorState =>
  editorReducer(initialState(), { type: 'load', name: 'Gym', status: 'draft', fields: [phone, name], settings: parseFormSettings({}) })

describe('form editor state', () => {
  it('loads clean and becomes dirty on any edit, clean again after save', () => {
    let s = load()
    expect(isDirty(s)).toBe(false)
    s = editorReducer(s, { type: 'name', name: 'Gym join' })
    expect(isDirty(s)).toBe(true)
    s = editorReducer(s, { type: 'markSaved' })
    expect(isDirty(s)).toBe(false)
  })

  it('adds fields with unique ids', () => {
    let s = load()
    s = editorReducer(s, { type: 'add', field: { id: 'email', kind: 'email' } })
    s = editorReducer(s, { type: 'add', field: { id: 'email', kind: 'email' } })
    expect(s.fields.map((f) => f.id)).toEqual(['phone', 'name', 'email', 'email_2'])
    expect(newFieldId(s.fields, 'email')).toBe('email_3')
  })

  it('the phone field cannot be removed, made optional or retyped', () => {
    let s = load()
    s = editorReducer(s, { type: 'remove', id: 'phone' })
    expect(s.fields.some((f) => f.kind === 'phone')).toBe(true)
    s = editorReducer(s, { type: 'update', id: 'phone', patch: { required: false, kind: 'name', label: 'WhatsApp' } })
    expect(s.fields[0]).toMatchObject({ kind: 'phone', required: true, label: 'WhatsApp' })
  })

  it('reorders and ignores impossible moves', () => {
    let s = load()
    s = editorReducer(s, { type: 'add', field: { id: 'email', kind: 'email' } })
    s = editorReducer(s, { type: 'move', from: 2, to: 1 })
    expect(s.fields.map((f) => f.id)).toEqual(['phone', 'email', 'name'])
    expect(editorReducer(s, { type: 'move', from: 0, to: 9 })).toBe(s)
  })

  it('merges nested settings without losing siblings', () => {
    const base = parseFormSettings({ success: { action: 'message', message: 'Hi' }, qualification: { enabled: true, threshold: 5 } })
    const next = mergeSettings(base, { success: { action: 'whatsapp' } })
    expect(next.success).toMatchObject({ action: 'whatsapp', message: 'Hi' })
    expect(next.qualification).toMatchObject({ enabled: true, threshold: 5 })
    expect(mergeSettings(next, { autoTag: 'vip' }).autoTag).toBe('vip')
    expect(mergeSettings({ ...next, autoTag: 'vip' }, { autoTag: undefined }).autoTag).toBeUndefined()
  })
})
