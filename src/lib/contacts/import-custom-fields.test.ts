import { describe, expect, it } from 'vitest';
import { parseContactCsv, parseCustomColumns } from './parse-contact-csv';
import { autoMapColumns, inferFieldType, planRowCustomValues } from './import-custom-fields';
import type { FieldDef } from '@/lib/custom-fields/types';

const csv = `phone,name,Plan,Amount,Started date,Auto-renew,notes
+15551234567,Ada,Gold,"15,000",2026-11-02,yes,"likes yoga, boxing"

+15559876543,Bob,Silver,8000,not a date,no,`;

describe('parseCustomColumns', () => {
  it('returns the non-standard columns and row cells aligned with parseContactCsv', () => {
    const extra = parseCustomColumns(csv);
    expect(extra.columns.map((c) => c.header)).toEqual(['Plan', 'Amount', 'Started date', 'Auto-renew', 'notes']);
    const main = parseContactCsv(csv);
    expect(extra.values).toHaveLength(main.rows.length);
    expect(extra.values[0][extra.columns[1].index]).toBe('15,000');
    expect(extra.values[0][extra.columns[4].index]).toBe('likes yoga, boxing');
    expect(extra.values[1][extra.columns[0].index]).toBe('Silver');
  });
  it('is empty when there are no extra columns', () => {
    expect(parseCustomColumns('phone,name\n+1555,A').columns).toEqual([]);
  });
});

describe('inferFieldType', () => {
  it('guesses number, bool, date and text', () => {
    expect(inferFieldType(['15,000', '8000', ''])).toBe('number');
    expect(inferFieldType(['yes', 'No'])).toBe('bool');
    expect(inferFieldType(['2026-11-02', '2026-01-01'])).toBe('date');
    expect(inferFieldType(['Gold', 'Silver'])).toBe('text');
    expect(inferFieldType([])).toBe('text');
  });
});

const fields: FieldDef[] = [
  { id: 'f-plan', key: 'plan', field_name: 'Plan', field_type: 'enum', field_options: { options: ['Gold', 'Silver'] } },
  { id: 'f-amt', key: 'amount', field_name: 'Amount', field_type: 'number' },
  { id: 'f-start', key: 'started_date', field_name: 'Started', field_type: 'date' },
];

describe('autoMapColumns', () => {
  const extra = parseCustomColumns(csv);
  it('matches by name or key, creates the rest when allowed, skips otherwise', () => {
    const m = autoMapColumns(extra.columns, fields, () => [], true);
    expect(m[extra.columns[0].index]).toEqual({ kind: 'field', fieldId: 'f-plan' });
    expect(m[extra.columns[1].index]).toEqual({ kind: 'field', fieldId: 'f-amt' });
    expect(m[extra.columns[2].index]).toEqual({ kind: 'field', fieldId: 'f-start' }); // key "started_date"
    expect(m[extra.columns[3].index]).toMatchObject({ kind: 'create' });
    const noCreate = autoMapColumns(extra.columns, fields, () => [], false);
    expect(noCreate[extra.columns[3].index]).toEqual({ kind: 'skip' });
  });
});

describe('planRowCustomValues', () => {
  const extra = parseCustomColumns(csv);
  const mapping = autoMapColumns(extra.columns, fields, () => [], false);
  const byId = new Map(fields.map((f) => [f.id, f]));
  it('types good cells and reports bad ones without dropping the row', () => {
    const good = planRowCustomValues(extra.values[0], mapping, byId);
    expect(good.errors).toEqual([]);
    expect(good.upserts.find((u) => u.custom_field_id === 'f-amt')).toMatchObject({ value: '15000', value_number: 15000 });
    const bad = planRowCustomValues(extra.values[1], mapping, byId);
    expect(bad.upserts.map((u) => u.custom_field_id).sort()).toEqual(['f-amt', 'f-plan']);
    expect(bad.errors).toEqual([{ field: 'Started', reason: expect.stringContaining('valid date') }]);
  });
  it('ignores blank cells so an import never erases data', () => {
    const plan = planRowCustomValues({ 0: '', 1: '' }, { 0: { kind: 'field', fieldId: 'f-amt' } }, byId);
    expect(plan.upserts).toEqual([]);
    expect(plan.errors).toEqual([]);
  });
});
