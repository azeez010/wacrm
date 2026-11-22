import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { parsePreviewEdit, previewEditAction } from './preview-edit'
import { Editable, EditContext } from '@/components/public-form/editable'
import { EMBED_SCRIPT } from './embed-script'

describe('preview edits', () => {
  it('maps edits to editor actions', () => {
    expect(previewEditAction({ kind: 'setting', key: 'title', value: 'Hi' })).toEqual({ type: 'settings', patch: { title: 'Hi' } })
    expect(previewEditAction({ kind: 'greeting', value: 'Chat' })).toEqual({ type: 'settings', patch: { widget: { greeting: 'Chat' } } })
    expect(previewEditAction({ kind: 'field', fieldId: 'name', key: 'label', value: 'Full name' })).toEqual({ type: 'update', id: 'name', patch: { label: 'Full name' } })
  })
  it('rejects malformed messages and clips long values', () => {
    expect(parsePreviewEdit(null)).toBeNull()
    expect(parsePreviewEdit({ kind: 'setting', key: 'accent', value: 'x' })).toBeNull()
    expect(parsePreviewEdit({ kind: 'field', key: 'label', value: 'x' })).toBeNull()
    expect(parsePreviewEdit({ kind: 'setting', key: 'title', value: 'x'.repeat(500) })).toMatchObject({ value: 'x'.repeat(200) })
  })
  it('text is editable only inside the preview context', () => {
    const el = createElement(Editable, { target: { kind: 'setting', key: 'title' }, value: 'Join' })
    expect(renderToStaticMarkup(el)).toBe('Join')
    expect(renderToStaticMarkup(createElement(EditContext.Provider, { value: () => {} }, el))).toContain('data-og-edit')
  })
  it('the embed script relays preview edits and keeps its size budget', () => {
    expect(EMBED_SCRIPT).toContain('ogadesk-preview-edit')
    expect(EMBED_SCRIPT.length).toBeLessThan(18000)
    expect(() => new Function(EMBED_SCRIPT)).not.toThrow()
  })
})
