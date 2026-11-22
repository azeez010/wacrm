import { describe, expect, it, vi } from 'vitest'
import { resolveTableGroups, tableRowKey } from './import-tables'
import { buildSystemFields, type PreparedRow } from './import-mapping'

const fields = buildSystemFields(
  [{ id: 'f-prof', key: 'profile', field_name: 'Profile', field_type: 'reference', field_options: { table_key: 'profiles' } }],
  {
    profiles: {
      key: 'profiles',
      name: 'Profiles',
      labelKey: 'name',
      columns: [
        { key: 'name', name: 'Name', type: 'text' },
        { key: 'age', name: 'Age', type: 'number' },
      ],
    },
  },
)
const row = (name: string, age: string): PreparedRow => ({
  line: 0,
  phone: '+1',
  tagNames: [],
  custom: {},
  tables: { 'f-prof': { name, age } },
})

describe('resolveTableGroups', () => {
  it('sends each distinct label once and maps outcomes back', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      return {
        ok: true,
        json: async () => ({
          results: body.rows.map((r: { values: { name: string } }, i: number) => ({
            label: r.values.name,
            id: `rec-${i}`,
            created: r.values.name === 'Chidi',
          })),
        }),
      }
    })
    const out = await resolveTableGroups({
      rows: [row('Chidi', '30'), row('chidi', '31'), row('Ife', '25')],
      fields,
      tableKeyByFieldId: { 'f-prof': 'profiles' },
      createMissing: true,
      fetchImpl,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(sent.rows).toHaveLength(2) // Chidi/chidi collapse
    expect(sent.create_missing).toBe(true)
    expect(out.byKey.get(tableRowKey('f-prof', 'CHIDI'))).toMatchObject({ id: 'rec-0', created: true })
    expect(out.createdCount).toBe(1)
  })
  it('reports a server failure on every affected label', async () => {
    const out = await resolveTableGroups({
      rows: [row('Chidi', '30')],
      fields,
      tableKeyByFieldId: { 'f-prof': 'profiles' },
      createMissing: false,
      fetchImpl: async () => ({ ok: false, json: async () => ({ error: 'nope' }) }),
    })
    expect(out.byKey.get(tableRowKey('f-prof', 'chidi'))).toEqual({ id: null, created: false, error: 'nope' })
  })
  it('flags a table group mapped without its label column', async () => {
    const noLabel = fields.filter((f) => f.id !== 'ref:f-prof:name')
    const out = await resolveTableGroups({
      rows: [{ ...row('x', '1'), tables: { 'f-prof': { age: '1' } } }],
      fields: noLabel,
      tableKeyByFieldId: { 'f-prof': 'profiles' },
      createMissing: true,
      fetchImpl: vi.fn(),
    })
    expect(out.missingLabel.has('f-prof')).toBe(true)
  })
})
