import { describe, expect, it } from 'vitest'
import { IMPORT_MAX_ROWS, rowsFromCsv, rowsFromList } from './contacts-import'

describe('rowsFromCsv', () => {
  it('maps known columns and treats the rest as custom fields', () => {
    const r = rowsFromCsv('Phone,Full Name,Email,Company,Tags,Plan\n+2348012345678,Ada,ada@x.com,Acme,vip;lagos,Gold\n')
    expect(r).toEqual({
      ok: true,
      rows: [{ phone: '+2348012345678', name: 'Ada', email: 'ada@x.com', company: 'Acme', tags: ['vip', 'lagos'], custom_fields: { plan: 'Gold' } }],
    })
  })
  it('handles quoted cells, semicolon delimiters and empty cells', () => {
    const r = rowsFromCsv('phone;name\n"+2348012345678";"Ada, Jr."\n+2348099999999;\n')
    expect(r.ok && r.rows).toEqual([{ phone: '+2348012345678', name: 'Ada, Jr.' }, { phone: '+2348099999999' }])
  })
  it('needs a phone column and at least one row, and caps the size', () => {
    expect(rowsFromCsv('name\nAda')).toMatchObject({ ok: false })
    expect(rowsFromCsv('phone\n')).toMatchObject({ ok: false })
    const big = 'phone\n' + Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `+23480000${String(i).padStart(5, '0')}`).join('\n')
    expect(rowsFromCsv(big)).toMatchObject({ ok: false })
  })
})

describe('rowsFromList', () => {
  it('validates the list', () => {
    expect(rowsFromList([])).toMatchObject({ ok: false })
    expect(rowsFromList(['x'])).toMatchObject({ ok: false })
    expect(rowsFromList([{ phone: ' +2348012345678 ', tags: ['a', 1] }])).toEqual({ ok: true, rows: [{ phone: '+2348012345678', name: undefined, email: undefined, company: undefined, tags: ['a'], custom_fields: undefined }] })
  })
})
