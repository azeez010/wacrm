import { describe, expect, it } from 'vitest'
import { parseCsvGrid } from './csv-grid'
import {
  applyMapping,
  autoMapWithTableNames,
  buildSystemFields,
  instructionHeaders,
  mappedCount,
  validateCustomValues,
  type Mapping,
} from './import-mapping'
import type { FieldDef } from '@/lib/custom-fields/types'

const fields = [
  { id: 'f-bal', key: 'balance', field_name: 'Balance', field_type: 'number' as const },
  { id: 'f-out', key: 'outstanding', field_name: 'Outstanding', field_type: 'text' as const },
  { id: 'f-photo', key: 'photo', field_name: 'Photo', field_type: 'media' as const },
  { id: 'f-prof', key: 'profile', field_name: 'Profile', field_type: 'reference' as const, field_options: { table_key: 'profiles' } },
]
const tables = {
  profiles: {
    key: 'profiles',
    name: 'Profiles',
    labelKey: 'name',
    columns: [
      { key: 'name', name: 'Name', type: 'text' as const },
      { key: 'age', name: 'Age', type: 'number' as const },
    ],
  },
}
const sys = buildSystemFields(fields, tables)

describe('buildSystemFields', () => {
  it('lists core fields, custom fields and table columns, skipping media', () => {
    expect(sys.map((s) => s.id)).toEqual([
      'phone', 'name', 'email', 'company', 'tags',
      'cf:f-bal', 'cf:f-out',
      'ref:f-prof:name', 'ref:f-prof:age',
    ])
    expect(sys.find((s) => s.id === 'ref:f-prof:name')).toMatchObject({ header: 'profile.name', isLabel: true })
  })
  it('generates the headers shown in the instructions', () => {
    expect(instructionHeaders(sys)).toEqual({ custom: ['balance', 'outstanding'], table: ['profile.name', 'profile.age'] })
  })
})

describe('autoMapWithTableNames', () => {
  it('matches exact headers only, ignoring case and spaces', () => {
    const g = parseCsvGrid('Phone, NAME ,Balance,profile.name,Profile.Age,profile_name,profileAge,extra\n+1,A,5,Ada,30,x,y,z')
    const m = autoMapWithTableNames(g.headers, sys)
    expect(m.phone).toEqual({ kind: 'column', index: 0 })
    expect(m.name).toEqual({ kind: 'column', index: 1 })
    expect(m['cf:f-bal']).toEqual({ kind: 'column', index: 2 })
    expect(m['ref:f-prof:name']).toEqual({ kind: 'column', index: 3 })
    expect(m['ref:f-prof:age']).toEqual({ kind: 'column', index: 4 })
    // no fuzzy matches
    expect(Object.values(m).some((s) => s && s.kind === 'column' && (s.index === 5 || s.index === 6))).toBe(false)
    expect(m['cf:f-out']).toBeUndefined()
  })
  it('lets a header feed only one field', () => {
    const g = parseCsvGrid('phone,balance,balance\n+1,5,6')
    const m = autoMapWithTableNames(g.headers, sys)
    expect(m['cf:f-bal']).toEqual({ kind: 'column', index: 1 })
    expect(mappedCount(m)).toBe(2)
  })
})

describe('applyMapping', () => {
  const g = parseCsvGrid('phone,name,tags,balance,profile.name,profile.age\n+1,Ada,"vip, lead",15000,Chidi,30\n+2,,, ,,')
  const m: Mapping = {
    phone: { kind: 'column', index: 0 },
    name: { kind: 'column', index: 1, fallback: 'Unknown' },
    tags: { kind: 'column', index: 2, fallback: 'imported' },
    company: { kind: 'fixed', value: 'Acme' },
    'cf:f-bal': { kind: 'column', index: 3 },
    'cf:f-out': { kind: 'fixed', value: 'none' },
    'ref:f-prof:name': { kind: 'column', index: 4 },
    'ref:f-prof:age': { kind: 'column', index: 5 },
  }
  it('applies columns, defaults for blanks and fixed values', () => {
    const rows = applyMapping(g, m, sys)
    expect(rows[0]).toMatchObject({ phone: '+1', name: 'Ada', company: 'Acme', tagNames: ['vip', 'lead', 'imported'] })
    expect(rows[0].custom).toEqual({ 'f-bal': '15000', 'f-out': 'none' })
    expect(rows[0].tables).toEqual({ 'f-prof': { name: 'Chidi', age: '30' } })
    // blank cells fall back to the default; a tag default applies to everyone
    expect(rows[1]).toMatchObject({ phone: '+2', name: 'Unknown', company: 'Acme', tagNames: ['imported'] })
    expect(rows[1].tables).toEqual({})
  })
  it('lets a fixed tag text stand alone', () => {
    const rows = applyMapping(g, { phone: { kind: 'column', index: 0 }, tags: { kind: 'fixed', value: 'november, import' } }, sys)
    expect(rows[0].tagNames).toEqual(['november', 'import'])
  })
})

describe('validateCustomValues', () => {
  const defs = new Map<string, FieldDef>(
    sys.filter((s) => s.def && s.group === 'custom').map((s) => [s.def!.id, s.def!]),
  )
  it('types good values and reports bad ones without throwing', () => {
    const out = validateCustomValues({ 'f-bal': '15,000', 'f-out': 'ok', gone: 'x' }, defs)
    expect(out.values['f-bal']).toMatchObject({ value: '15000', value_number: 15000 })
    expect(out.issues).toEqual([])
    const bad = validateCustomValues({ 'f-bal': 'abc' }, defs)
    expect(bad.issues).toHaveLength(1)
    expect(bad.values).toEqual({})
  })
})
