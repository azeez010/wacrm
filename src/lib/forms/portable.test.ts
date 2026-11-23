import { describe, expect, it } from 'vitest'
import { buildFormDoc, parseFormDoc, resolveFormDoc, usedRefs, type TargetNames } from './portable'

const TAG = '11111111-1111-4111-8111-111111111111'
const CF = '22222222-2222-4222-8222-222222222222'
const PIPE = '33333333-3333-4333-8333-333333333333'
const STAGE = '44444444-4444-4444-8444-444444444444'

const form = {
  kind: 'lead' as const,
  name: 'Spring',
  fields: [
    { id: 'phone', kind: 'phone' },
    { id: 'tags', kind: 'tag_picker', tagIds: [TAG] },
    { id: 'budget', kind: 'custom_field', customFieldId: CF },
    { id: 'h', kind: 'hidden', param: 'ad', targetField: `cf:${CF}` },
  ],
  settings: { scoreFieldId: CF, pipeline: { pipelineId: PIPE, stageId: STAGE }, assignment: { mode: 'agent', agentIds: ['x'] }, notify: { mode: 'selected', agentIds: ['x'] }, whatsappConfigId: 'w', autoTag: 'spring' },
} as never

const names = {
  tags: new Map([[TAG, 'VIP']]),
  fields: new Map([[CF, { key: 'budget', name: 'Budget' }]]),
  pipelines: new Map([[PIPE, { name: 'Sales', stages: new Map([[STAGE, 'New']]) }]]),
}

describe('form export / import', () => {
  it('finds every account-specific id a form uses', () => {
    const u = usedRefs((form as never as { fields: never[] }).fields, (form as never as { settings: never }).settings)
    expect(u).toEqual({ tags: [TAG], customFields: [CF], pipelineId: PIPE, stageId: STAGE })
  })

  it('exports names next to ids, and imports into another account by name', () => {
    const doc = buildFormDoc(form, names, new Date('2026-01-01T00:00:00Z'))
    expect(doc.refs).toEqual({ tags: { [TAG]: 'VIP' }, fields: { [CF]: { key: 'budget', name: 'Budget' } }, pipelines: { [PIPE]: { name: 'Sales', stages: { [STAGE]: 'New' } } } })

    const NEW_TAG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const NEW_CF = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const NEW_P = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const NEW_S = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const target: TargetNames = {
      tagIdByName: new Map([['vip', NEW_TAG]]),
      fieldIdByKey: new Map([['budget', NEW_CF]]),
      pipelineByName: new Map([['sales', { id: NEW_P, stageIdByName: new Map([['new', NEW_S]]) }]]),
    }
    const r = resolveFormDoc(doc, target)
    expect(r.fields.find((f) => f.kind === 'tag_picker')?.tagIds).toEqual([NEW_TAG])
    expect(r.fields.find((f) => f.kind === 'custom_field')?.customFieldId).toBe(NEW_CF)
    expect(r.fields.find((f) => f.kind === 'hidden')?.targetField).toBe(`cf:${NEW_CF}`)
    expect(r.settings.scoreFieldId).toBe(NEW_CF)
    expect(r.settings.pipeline).toEqual({ pipelineId: NEW_P, stageId: NEW_S })
    // People and numbers never travel.
    expect(r.settings.assignment).toEqual({ mode: 'none' })
    expect(r.settings.notify).toEqual({ mode: 'all' })
    expect(r.settings.whatsappConfigId).toBeUndefined()
    expect(r.settings.autoTag).toBe('spring')
    expect(r.warnings.join(' ')).toContain('assignment')
  })

  it('drops what the target account does not have, with a warning each', () => {
    const doc = buildFormDoc(form, names)
    const r = resolveFormDoc(doc, { tagIdByName: new Map(), fieldIdByKey: new Map(), pipelineByName: new Map() })
    expect(r.fields.map((f) => f.kind)).toEqual(['phone', 'tag_picker', 'hidden'])
    expect(r.fields.find((f) => f.kind === 'tag_picker')?.tagIds).toEqual([])
    expect(r.fields.find((f) => f.kind === 'hidden')?.targetField).toBeUndefined()
    expect(r.settings.pipeline).toBeUndefined()
    expect(r.settings.scoreFieldId).toBeUndefined()
    expect(r.warnings.length).toBeGreaterThanOrEqual(4)
  })

  it('refuses files that are not OgaDesk forms', () => {
    expect(() => parseFormDoc(null)).toThrow()
    expect(() => parseFormDoc({ format: 'other' })).toThrow()
    expect(() => parseFormDoc({ format: 'ogadesk-form', version: 2, kind: 'lead', fields: [] })).toThrow()
    expect(() => parseFormDoc({ format: 'ogadesk-form', version: 1, kind: 'nope', fields: [] })).toThrow()
    expect(parseFormDoc({ format: 'ogadesk-form', version: 1, kind: 'lead', fields: [], name: 'X' }).name).toBe('X')
  })
})
