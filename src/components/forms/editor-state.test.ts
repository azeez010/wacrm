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

describe('conditions stay valid while editing', () => {
  const rule = { match: 'all' as const, rules: [{ fieldId: 'company', op: 'filled' as const }] }
  const base = () =>
    editorReducer(initialState(), {
      type: 'load',
      name: 'f',
      status: 'draft',
      settings: parseFormSettings({}),
      fields: [
        { id: 'phone', kind: 'phone', label: 'Phone' },
        { id: 'company', kind: 'company', label: 'Company' },
        { id: 'message', kind: 'message', label: 'More', visibleWhen: rule },
      ],
    })

  it('removing the field a rule points at drops the condition', () => {
    const s = editorReducer(base(), { type: 'remove', id: 'company' })
    expect(s.fields.find((f) => f.id === 'message')?.visibleWhen).toBeUndefined()
  })

  it('moving the conditional field above its source drops the condition', () => {
    const s = editorReducer(base(), { type: 'move', from: 2, to: 1 })
    expect(s.fields.map((f) => f.id)).toEqual(['phone', 'message', 'company'])
    expect(s.fields[1].visibleWhen).toBeUndefined()
  })
})

describe('typing spaces in settings', () => {
  it('keeps a trailing space while typing', async () => {
    const { mergeSettings } = await import('./editor-state')
    const { parseFormSettings } = await import('@/lib/forms/types')
    const s = mergeSettings(parseFormSettings({}), { widget: { preMessage: 'Hi, ' } })
    expect(s.widget?.preMessage).toBe('Hi, ')
    expect(mergeSettings(s, { title: 'A ' }).title).toBe('A ')
  })
})
