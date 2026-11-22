import { coerceValue, slugifyKey } from '@/lib/custom-fields/coerce';
import type { FieldDef, FieldType, TypedColumns } from '@/lib/custom-fields/types';
import type { CsvExtraColumn } from './parse-contact-csv';

// ============================================================
// Mapping CSV columns onto custom fields during contact import:
// auto-match by name/key, infer a sensible type for new fields, and
// turn each row's cells into validated, typed value rows.
// ============================================================

/** What to do with one CSV column. */
export type ColumnTarget =
  | { kind: 'skip' }
  | { kind: 'field'; fieldId: string }
  | { kind: 'create'; type: FieldType };

export type ColumnMapping = Record<number, ColumnTarget>;

type MatchableField = Pick<FieldDef, 'id' | 'key' | 'field_name'>;

const BOOL_WORDS = new Set(['true', 'false', 'yes', 'no', 'y', 'n']);

/** Guess a field type from sample cells (ignoring blanks). */
export function inferFieldType(samples: string[]): FieldType {
  const filled = samples.map((s) => s.trim()).filter(Boolean)
  if (filled.length === 0) return 'text'
  if (filled.every((s) => BOOL_WORDS.has(s.toLowerCase()))) return 'bool'
  if (filled.every((s) => /^[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s) && !/^\+\d{8,}$/.test(s))) return 'number'
  if (filled.every((s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s))) return 'email'
  if (filled.every((s) => /^https?:\/\/\S+\.\S+$/i.test(s))) return 'url'
  if (filled.every((s) => /^\+\d[\d\s().-]{7,}$/.test(s))) return 'phone'
  if (filled.every((s) => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s) && !Number.isNaN(Date.parse(s)))) return 'datetime'
  if (filled.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)))) return 'date'
  return 'text'
}

/**
 * Initial mapping for every extra column: an existing field when the
 * header equals its name or key, otherwise "create" (when the user may
 * create fields) or "skip".
 */
export function autoMapColumns(
  columns: CsvExtraColumn[],
  fields: MatchableField[],
  sampleFor: (index: number) => string[],
  canCreate: boolean,
): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<string>();
  for (const col of columns) {
    const lower = col.header.toLowerCase();
    const slug = slugifyKey(col.header);
    const match = fields.find(
      (f) => !taken.has(f.id) && (f.field_name.toLowerCase() === lower || f.key === slug),
    );
    if (match) {
      mapping[col.index] = { kind: 'field', fieldId: match.id };
      taken.add(match.id);
    } else if (canCreate) {
      mapping[col.index] = { kind: 'create', type: inferFieldType(sampleFor(col.index)) };
    } else {
      mapping[col.index] = { kind: 'skip' };
    }
  }
  return mapping;
}

export interface CustomValueRow extends TypedColumns {
  custom_field_id: string;
  value: string;
}

export interface RowCustomPlan {
  upserts: CustomValueRow[];
  errors: { field: string; reason: string }[];
}

/**
 * Validate one row's mapped cells. Blank cells are skipped (an import
 * never erases a stored value). A bad cell is reported and left out; the
 * contact itself still imports.
 */
export function planRowCustomValues(
  cells: Record<number, string> | undefined,
  mapping: ColumnMapping,
  fieldsById: Map<string, FieldDef>,
): RowCustomPlan {
  const plan: RowCustomPlan = { upserts: [], errors: [] };
  if (!cells) return plan;
  for (const [idx, target] of Object.entries(mapping)) {
    if (target.kind !== 'field') continue;
    const raw = (cells[Number(idx)] ?? '').trim();
    if (!raw) continue;
    const field = fieldsById.get(target.fieldId);
    if (!field) continue;
    const res = coerceValue(field, raw);
    if (!res.ok) plan.errors.push({ field: field.field_name, reason: res.error });
    else if (!res.clear) plan.upserts.push({ custom_field_id: field.id, ...res.value });
  }
  return plan;
}
