'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CustomFieldInput } from '@/components/custom-fields/custom-field-input';
import type { Tag } from '@/types';
import type { FieldSource, Mapping, SystemField, SystemFieldId } from '@/lib/contacts/import-mapping';

const SKIP = '__skip__';
const FIXED = '__fixed__';

interface Props {
  fields: SystemField[];
  headers: string[];
  /** A few cells per column, to show what each CSV column looks like. */
  samples: string[][];
  mapping: Mapping;
  onChange: (next: Mapping) => void;
  tags: Tag[];
  disabled?: boolean;
}

/** Plain-input editor for core fields and tag text; typed editor for everything else. */
function ValueEditor({
  field,
  value,
  onChange,
  tags,
  placeholder,
}: {
  field: SystemField;
  value: string;
  onChange: (v: string) => void;
  tags: Tag[];
  placeholder?: string;
}) {
  const t = useTranslations('Contacts.importModal.map');
  if (field.kind === 'tags') {
    const chosen = new Set(value.split(/[,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean));
    return (
      <div className="space-y-1.5">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? t('tagsPlaceholder')}
          className="h-8 bg-muted text-xs"
        />
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 12).map((tg) => {
              const on = chosen.has(tg.name.toLowerCase());
              return (
                <button
                  key={tg.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const list = value.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
                    const next = on
                      ? list.filter((x) => x.toLowerCase() !== tg.name.toLowerCase())
                      : [...list, tg.name];
                    onChange(next.join(', '));
                  }}
                  className="rounded-full border px-2 py-0.5 text-[11px] transition-colors"
                  style={{
                    color: tg.color,
                    borderColor: on ? tg.color : 'transparent',
                    backgroundColor: tg.color + (on ? '30' : '18'),
                  }}
                >
                  {tg.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  if (field.def && field.kind !== 'core_text') {
    return (
      <CustomFieldInput
        field={{ field_name: field.label, field_type: field.def.field_type, field_options: field.def.field_options }}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="h-8 text-xs"
      />
    );
  }
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? t('valuePlaceholder')}
      className="h-8 bg-muted text-xs"
    />
  );
}

function MappingRow({
  field,
  headers,
  samples,
  source,
  taken,
  onChange,
  tags,
  disabled,
}: {
  field: SystemField;
  headers: string[];
  samples: string[][];
  source: FieldSource | undefined;
  /** Columns already used by other fields (still selectable, marked). */
  taken: Set<number>;
  onChange: (s: FieldSource) => void;
  tags: Tag[];
  disabled?: boolean;
}) {
  const t = useTranslations('Contacts.importModal.map');
  const tt = useTranslations('Contacts.customFields.types');
  const src: FieldSource = source ?? { kind: 'skip' };
  const value = src.kind === 'column' ? `col:${src.index}` : src.kind === 'fixed' ? FIXED : SKIP;
  const canFixed = !field.required;
  const [showFallback, setShowFallback] = useState(src.kind === 'column' && !!src.fallback);

  const label =
    src.kind === 'column'
      ? headers[src.index] || t('columnN', { n: src.index + 1 })
      : src.kind === 'fixed'
        ? t('fixedValue')
        : t('skip');

  return (
    <div className="space-y-1.5 py-1.5">
      <div className="flex items-center gap-2">
        <div className="flex w-2/5 min-w-0 items-center gap-1.5">
          <span className="truncate text-sm text-popover-foreground">{field.label}</span>
          {field.required && <span className="text-red-400">*</span>}
          <span className="hidden shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
            {field.kind === 'tags' || field.kind === 'core_text' ? t(`kind.${field.kind}`) : tt(field.kind)}
          </span>
        </div>
        <span className="text-muted-foreground">→</span>
        <Select
          value={value}
          disabled={disabled}
          onValueChange={(v) => {
            if (!v) return;
            if (v === SKIP) onChange({ kind: 'skip' });
            else if (v === FIXED) onChange({ kind: 'fixed', value: src.kind === 'fixed' ? src.value : '' });
            else onChange({ kind: 'column', index: Number(v.slice(4)), fallback: src.kind === 'column' ? src.fallback : undefined });
          }}
        >
          <SelectTrigger className={cn('h-8 flex-1 text-xs', src.kind === 'skip' && 'text-muted-foreground')}>
            <SelectValue>{label}</SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {!field.required && <SelectItem value={SKIP}>{t('skip')}</SelectItem>}
            {canFixed && <SelectItem value={FIXED}>{t('fixedValueAll')}</SelectItem>}
            {headers.map((h, i) => (
              <SelectItem key={i} value={`col:${i}`}>
                <span className="flex flex-col">
                  <span>
                    {h || t('columnN', { n: i + 1 })}
                    {taken.has(i) && <span className="ml-1 text-[10px] text-muted-foreground">{t('inUse')}</span>}
                  </span>
                  {samples[i]?.[0] && <span className="text-[10px] text-muted-foreground">{samples[i][0]}</span>}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {src.kind === 'fixed' && (
        <div className="pl-[calc(40%+1.25rem)]">
          <ValueEditor
            field={field}
            value={src.value}
            onChange={(v) => onChange({ kind: 'fixed', value: v })}
            tags={tags}
          />
        </div>
      )}

      {src.kind === 'column' && (
        <div className="pl-[calc(40%+1.25rem)]">
          {showFallback || src.fallback ? (
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">
                {field.kind === 'tags' ? t('tagsEveryone') : t('fallbackLabel')}
              </p>
              <ValueEditor
                field={field}
                value={src.fallback ?? ''}
                onChange={(v) => onChange({ ...src, fallback: v })}
                tags={tags}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowFallback(true)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
            >
              <Plus className="size-3" />
              {field.kind === 'tags' ? t('addTagsEveryone') : t('addFallback')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Key-value mapping: each field of the system on the left, where its value
 * comes from on the right (a CSV column, one fixed value for every row, or
 * nothing). Quiet by default: core fields and anything matched are shown;
 * the rest sits behind "Show more fields".
 */
export function ImportMappingList({ fields, headers, samples, mapping, onChange, tags, disabled }: Props) {
  const t = useTranslations('Contacts.importModal.map');
  const [showAll, setShowAll] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const taken = useMemo(() => {
    const s = new Set<number>();
    for (const src of Object.values(mapping)) if (src && src.kind === 'column') s.add(src.index);
    return s;
  }, [mapping]);

  const set = (id: SystemFieldId, src: FieldSource) => onChange({ ...mapping, [id]: src });
  const isActive = (f: SystemField) => {
    const s = mapping[f.id];
    return !!s && s.kind !== 'skip';
  };

  const core = fields.filter((f) => f.group === 'core');
  const custom = fields.filter((f) => f.group === 'custom');
  const visibleCustom = custom.filter((f) => showAll || isActive(f));
  const hiddenCustom = custom.length - visibleCustom.length;

  // Table columns, grouped by the contact field they hang off.
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; fields: SystemField[] }>();
    for (const f of fields.filter((x) => x.group === 'table')) {
      const key = f.refFieldId as string;
      if (!map.has(key)) map.set(key, { id: key, name: f.refFieldName ?? key, fields: [] });
      map.get(key)!.fields.push(f);
    }
    return [...map.values()];
  }, [fields]);

  const row = (f: SystemField) => (
    <MappingRow
      key={f.id}
      field={f}
      headers={headers}
      samples={samples}
      source={mapping[f.id]}
      taken={taken}
      onChange={(s) => set(f.id, s)}
      tags={tags}
      disabled={disabled}
    />
  );

  return (
    <div className="divide-y divide-border/60 rounded-xl border border-border px-3">
      {core.map(row)}
      {visibleCustom.map(row)}
      {groups.map((g) => {
        const active = g.fields.some(isActive);
        const open = openGroups.has(g.id) || active;
        return (
          <div key={g.id} className="py-1">
            <button
              type="button"
              onClick={() =>
                setOpenGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(g.id) && !active) next.delete(g.id);
                  else next.add(g.id);
                  return next;
                })
              }
              className="flex w-full items-center gap-2 py-1.5 text-left text-sm text-popover-foreground"
            >
              <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', !open && '-rotate-90')} />
              <span className="font-medium">{g.name}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t('tableBadge')}</span>
              {active && <span className="ml-auto text-[11px] text-primary">{t('mappedCount', { count: g.fields.filter(isActive).length })}</span>}
            </button>
            {open && <div className="ml-4 border-l border-border/60 pl-3">{g.fields.map(row)}</div>}
          </div>
        );
      })}
      {(hiddenCustom > 0 || (showAll && custom.length > 0)) && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="w-full py-2 text-left text-xs text-muted-foreground hover:text-foreground"
        >
          {showAll ? t('showFewer') : t('showMore', { count: hiddenCustom })}
        </button>
      )}
    </div>
  );
}
