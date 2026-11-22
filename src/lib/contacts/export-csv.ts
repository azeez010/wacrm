import { parseMultiValue } from '@/lib/custom-fields/format';
import { parseMediaValue } from '@/lib/custom-fields/media';
import type { FieldDef } from '@/lib/custom-fields/types';

// ============================================================
// Contacts CSV export. Header format matches what the import accepts
// (phone, name, email, company, tags + one column per custom field, named
// by the field), so export then re-import round-trips.
// ============================================================

export interface ExportContact {
  id: string;
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  blocked_at?: string | null;
  lead_source?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
}

export type ExportField = Pick<FieldDef, 'id' | 'field_name' | 'field_type'>;

function cell(value: string): string {
  // The import parser reads one record per line, so flatten newlines.
  const flat = value.replace(/\r?\n/g, ' ');
  return /[",]/.test(flat) ? `"${flat.replace(/"/g, '""')}"` : flat;
}

/** Canonical stored value -> the text an exported cell shows. */
export function exportCellValue(
  field: Pick<FieldDef, 'field_type'>,
  value: string | undefined,
  referenceLabel?: (id: string) => string | undefined,
): string {
  if (!value) return '';
  switch (field.field_type) {
    case 'date':
      return value.slice(0, 10);
    case 'multi_enum':
      return parseMultiValue(value).join('; ');
    case 'media': {
      const m = parseMediaValue(value);
      return m.ok ? m.value.url : '';
    }
    case 'reference':
      return referenceLabel?.(value) ?? '';
    default:
      return value;
  }
}

export function buildContactsCsv(input: {
  contacts: ExportContact[];
  fields: ExportField[];
  tagNamesByContact: Record<string, string[]>;
  valuesByContact: Record<string, Record<string, string>>;
  referenceLabel?: (id: string) => string | undefined;
}): string {
  const { contacts, fields, tagNamesByContact, valuesByContact, referenceLabel } = input;
  const header = ['phone', 'name', 'email', 'company', 'tags', 'blocked', 'lead_source', 'utm_source', 'utm_medium', 'utm_campaign', ...fields.map((f) => f.field_name)];
  const lines = [header.map(cell).join(',')];
  for (const c of contacts) {
    const row = [
      c.phone,
      c.name ?? '',
      c.email ?? '',
      c.company ?? '',
      (tagNamesByContact[c.id] ?? []).join('; '),
      c.blocked_at ? 'yes' : '',
      c.lead_source ?? '',
      c.utm_source ?? '',
      c.utm_medium ?? '',
      c.utm_campaign ?? '',
      ...fields.map((f) => exportCellValue(f, valuesByContact[c.id]?.[f.id], referenceLabel)),
    ];
    lines.push(row.map(cell).join(','));
  }
  return lines.join('\n') + '\n';
}
