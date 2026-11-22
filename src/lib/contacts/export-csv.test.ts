import { describe, expect, it } from 'vitest';
import { buildContactsCsv, exportCellValue } from './export-csv';
import { parseContactCsv, parseCustomColumns } from './parse-contact-csv';

describe('buildContactsCsv', () => {
  const csv = buildContactsCsv({
    contacts: [
      { id: 'c1', phone: '+15551234567', name: 'Ada, "AJ"', email: null, company: 'Acme' },
      { id: 'c2', phone: '+15559876543', name: 'Bob', email: 'b@x.com', company: null },
    ],
    fields: [
      { id: 'f1', field_name: 'Plan', field_type: 'enum' },
      { id: 'f2', field_name: 'Started date', field_type: 'date' },
      { id: 'f3', field_name: 'Sports', field_type: 'multi_enum' },
    ],
    tagNamesByContact: { c1: ['VIP', 'Lead'] },
    valuesByContact: {
      c1: { f1: 'Gold', f2: '2026-11-02T00:00:00.000Z', f3: '["Yoga","Boxing"]' },
    },
  });

  it('writes a header the importer understands and quotes tricky cells', () => {
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('phone,name,email,company,tags,blocked,Plan,Started date,Sports');
    expect(lines[1]).toContain('"Ada, ""AJ"""');
    expect(lines[1]).toContain('Gold,2026-11-02,Yoga; Boxing');
  });
  it('round-trips through the import parsers (same columns, same row count)', () => {
    const main = parseContactCsv(csv);
    const extra = parseCustomColumns(csv);
    expect(main.rows).toHaveLength(2);
    expect(main.rows[0].phone).toBe('+15551234567');
    expect(extra.columns.map((c) => c.header)).toEqual(['Plan', 'Started date', 'Sports']);
    expect(extra.values[1][extra.columns[0].index]).toBe('');
  });
});

describe('blocked column', () => {
  it('exports yes for blocked contacts and blank otherwise', () => {
    const out = buildContactsCsv({
      contacts: [
        { id: 'a', phone: '+1', blocked_at: '2026-01-01T00:00:00Z' },
        { id: 'b', phone: '+2' },
      ],
      fields: [],
      tagNamesByContact: {},
      valuesByContact: {},
    });
    const lines = out.trim().split('\n');
    expect(lines[0]).toBe('phone,name,email,company,tags,blocked');
    expect(lines[1].endsWith(',yes')).toBe(true);
    expect(lines[2].endsWith(',')).toBe(true);
  });
});

describe('exportCellValue', () => {
  it('resolves reference labels and blanks missing ones', () => {
    expect(exportCellValue({ field_type: 'reference' }, 'id1', () => 'Chidi')).toBe('Chidi');
    expect(exportCellValue({ field_type: 'reference' }, 'id1')).toBe('');
    expect(exportCellValue({ field_type: 'number' }, undefined)).toBe('');
  });
});
