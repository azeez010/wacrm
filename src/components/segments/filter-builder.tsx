'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { CustomFieldInput } from '@/components/custom-fields/custom-field-input';
import { ReferencePicker } from '@/components/custom-fields/reference-picker';
import type { CustomField, Tag } from '@/types';
import type { FieldType } from '@/lib/custom-fields/types';
import {
  OPERATORS_BY_KIND,
  RELATIVE_DATES,
  defaultOperator,
  isRelativeDate,
  valueShape,
  type FilterFieldKind,
} from '@/lib/segments/operators';
import { kindOf } from '@/lib/segments/validate';
import {
  FILTER_VERSION,
  isGroup,
  type FilterGroup,
  type FilterOperator,
  type FilterRule,
} from '@/lib/segments/types';

const BUILTIN_FIELDS = ['name', 'phone', 'email', 'company', 'tags', 'created_at'] as const;

interface FilterBuilderProps {
  value: FilterGroup;
  onChange: (next: FilterGroup) => void;
  customFields: CustomField[];
  tags: Tag[];
  className?: string;
}

/** Map of custom field id to filter kind, shared with `normalizeFilter`. */
export function customKindMap(fields: CustomField[]): Record<string, FilterFieldKind> {
  return Object.fromEntries(fields.map((f) => [f.id, f.field_type as FieldType]));
}

/** How many levels of "(...)" groups the editor lets you build (the database allows 4). */
const MAX_UI_DEPTH = 2;

/**
 * Compact rule editor: Match all/any, then one row per rule
 * (field, operator, value). Yes/No fields render as a switch. "Add group"
 * nests a sub-group with its own all/any, so "Gold AND (renews soon OR
 * unpaid)" can be built.
 */
export function FilterBuilder({ value, onChange, customFields, tags, className }: FilterBuilderProps) {
  return (
    <GroupEditor
      value={value}
      onChange={onChange}
      customFields={customFields}
      tags={tags}
      depth={0}
      className={className}
    />
  );
}

function GroupEditor({
  value,
  onChange,
  customFields,
  tags,
  depth,
  onRemove,
  className,
}: FilterBuilderProps & { depth: number; onRemove?: () => void }) {
  const t = useTranslations('Segments');
  const kinds = useMemo(() => customKindMap(customFields), [customFields]);
  const rules = value.rules;

  const setRules = (next: FilterGroup['rules']) => onChange({ ...value, rules: next });
  const updateAt = (i: number, item: FilterRule | FilterGroup) =>
    setRules(rules.map((r, j) => (j === i ? item : r)));
  const removeAt = (i: number) => setRules(rules.filter((_, j) => j !== i));

  function addRule() {
    setRules([...rules, { field: BUILTIN_FIELDS[0], operator: defaultOperator('builtin_text') }]);
  }
  function addGroup() {
    setRules([
      ...rules,
      {
        version: FILTER_VERSION,
        op: value.op === 'and' ? 'or' : 'and',
        rules: [{ field: BUILTIN_FIELDS[0], operator: defaultOperator('builtin_text') }],
      },
    ]);
  }

  return (
    <div
      className={cn(
        'space-y-2',
        depth > 0 && 'rounded-lg border border-border bg-muted/30 p-2.5',
        className
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t('match')}</span>
        <div className="inline-flex rounded-md border border-border p-0.5">
          {(['and', 'or'] as const).map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => onChange({ ...value, op })}
              aria-pressed={value.op === op}
              className={cn(
                'rounded px-2.5 py-0.5 text-xs font-medium transition-colors',
                value.op === op ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t(op === 'and' ? 'matchAll' : 'matchAny')}
            </button>
          ))}
        </div>
        {onRemove && (
          <div className="ml-auto">
            <RemoveButton onClick={onRemove} label={t('removeGroup')} />
          </div>
        )}
      </div>

      {rules.length === 0 && <p className="py-1 text-xs text-muted-foreground">{t('noRules')}</p>}

      {rules.map((rule, i) =>
        isGroup(rule) ? (
          <GroupEditor
            key={i}
            value={rule}
            onChange={(g) => updateAt(i, g)}
            customFields={customFields}
            tags={tags}
            depth={depth + 1}
            onRemove={() => removeAt(i)}
          />
        ) : (
          <RuleRow
            key={i}
            rule={rule}
            kinds={kinds}
            customFields={customFields}
            tags={tags}
            onChange={(r) => updateAt(i, r)}
            onRemove={() => removeAt(i)}
          />
        )
      )}

      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={addRule} className="-ml-2 h-7 text-xs text-muted-foreground">
          <Plus className="size-3.5" />
          {t('addRule')}
        </Button>
        {depth < MAX_UI_DEPTH && (
          <Button type="button" variant="ghost" size="sm" onClick={addGroup} className="h-7 text-xs text-muted-foreground">
            <Plus className="size-3.5" />
            {t('addGroup')}
          </Button>
        )}
      </div>
    </div>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" onClick={onClick} aria-label={label} title={label} className="shrink-0 text-muted-foreground">
      <X className="size-3.5" />
    </Button>
  );
}

function RuleRow({
  rule,
  kinds,
  customFields,
  tags,
  onChange,
  onRemove,
}: {
  rule: FilterRule;
  kinds: Record<string, FilterFieldKind>;
  customFields: CustomField[];
  tags: Tag[];
  onChange: (r: FilterRule) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('Segments');
  const kind = kindOf(rule.field, kinds) ?? 'builtin_text';
  const operators = OPERATORS_BY_KIND[kind];
  const shape = valueShape(rule.operator);
  const isBool = kind === 'bool';

  const fieldLabel = (f: string) =>
    f.startsWith('cf:') ? (customFields.find((c) => c.id === f.slice(3))?.field_name ?? t('unknownField')) : t(`fields.${f}`);

  function changeField(next: string) {
    const nextKind = kindOf(next, kinds) ?? 'builtin_text';
    const op = OPERATORS_BY_KIND[nextKind].includes(rule.operator) ? rule.operator : defaultOperator(nextKind);
    onChange({ field: next, operator: op, value: undefined });
  }

  function changeOperator(next: FilterOperator) {
    const nextShape = valueShape(next);
    let nextValue = rule.value;
    if (nextShape === 'none') nextValue = undefined;
    else if (nextShape === 'pair') nextValue = Array.isArray(rule.value) ? rule.value : ['', ''];
    else if (nextShape === 'list') nextValue = Array.isArray(rule.value) ? rule.value : [];
    else if (Array.isArray(rule.value)) nextValue = rule.value[0] ?? '';
    onChange({ ...rule, operator: next, value: nextValue });
  }

  const field = rule.field.startsWith('cf:') ? customFields.find((c) => c.id === rule.field.slice(3)) : undefined;

  const operatorSelect = (width: string) => (
    <Select value={rule.operator} onValueChange={(v) => v && changeOperator(v as FilterOperator)}>
      <SelectTrigger className={cn('h-8 text-xs', width)}>
        <SelectValue>{t(`operators.${rule.operator}`)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {operators.map((o) => (
          <SelectItem key={o} value={o}>
            {t(`operators.${o}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={rule.field} onValueChange={(v) => v && changeField(v)}>
        <SelectTrigger className="h-8 w-32 text-xs">
          <SelectValue>{fieldLabel(rule.field)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {BUILTIN_FIELDS.map((f) => (
            <SelectItem key={f} value={f}>
              {t(`fields.${f}`)}
            </SelectItem>
          ))}
          {customFields.map((c) => (
            <SelectItem key={c.id} value={`cf:${c.id}`}>
              {c.field_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isBool ? (
        <div className="flex h-8 items-center gap-2 px-1">
          <Switch
            checked={rule.operator === 'is_true'}
            disabled={rule.operator === 'is_empty' || rule.operator === 'is_set'}
            onCheckedChange={(on) => onChange({ ...rule, operator: on ? 'is_true' : 'is_false', value: undefined })}
            aria-label={fieldLabel(rule.field)}
          />
          <span className="text-xs text-muted-foreground">
            {rule.operator === 'is_true' ? t('on') : rule.operator === 'is_false' ? t('off') : ''}
          </span>
          {operatorSelect('w-28')}
        </div>
      ) : (
        <>
          {operatorSelect('w-32')}
          {shape !== 'none' && (
            <div className="min-w-[8rem] flex-1">
              <ValueEditor
                kind={kind}
                shape={shape}
                rule={rule}
                field={field}
                tags={tags}
                onChange={(v) => onChange({ ...rule, value: v })}
              />
            </div>
          )}
        </>
      )}
      <RemoveButton onClick={onRemove} label={t('removeRule')} />
    </div>
  );
}

function ValueEditor({
  kind,
  shape,
  rule,
  field,
  tags,
  onChange,
}: {
  kind: FilterFieldKind;
  shape: 'single' | 'pair' | 'list';
  rule: FilterRule;
  field?: CustomField;
  tags: Tag[];
  onChange: (v: unknown) => void;
}) {
  const t = useTranslations('Segments');

  if (shape === 'list') {
    const options: { id: string; label: string }[] =
      kind === 'tags'
        ? tags.map((tg) => ({ id: tg.id, label: tg.name }))
        : ((field?.field_options?.options as string[] | undefined) ?? []).map((o) => ({ id: o, label: o }));
    const picked = new Set(Array.isArray(rule.value) ? (rule.value as string[]) : []);
    return (
      <div className="flex flex-wrap gap-1">
        {options.length === 0 && <span className="text-xs text-muted-foreground">{t('noOptions')}</span>}
        {options.map((o) => {
          const on = picked.has(o.id);
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                const next = new Set(picked);
                if (on) next.delete(o.id);
                else next.add(o.id);
                onChange([...next]);
              }}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                on
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-muted text-muted-foreground hover:text-foreground'
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  if (shape === 'pair') {
    const pair = Array.isArray(rule.value) ? (rule.value as string[]) : ['', ''];
    const set = (i: number, v: string) => onChange(i === 0 ? [v, pair[1] ?? ''] : [pair[0] ?? '', v]);
    return (
      <div className="flex items-center gap-1.5">
        <SingleValue kind={kind} value={pair[0] ?? ''} onChange={(v) => set(0, v)} field={field} />
        <span className="text-xs text-muted-foreground">{t('and')}</span>
        <SingleValue kind={kind} value={pair[1] ?? ''} onChange={(v) => set(1, v)} field={field} />
      </div>
    );
  }

  return (
    <SingleValue kind={kind} value={rule.value == null ? '' : String(rule.value)} onChange={onChange} field={field} />
  );
}

function SingleValue({
  kind,
  value,
  onChange,
  field,
}: {
  kind: FilterFieldKind;
  value: string;
  onChange: (v: string) => void;
  field?: CustomField;
}) {
  const t = useTranslations('Segments');
  const base = 'h-8 bg-muted text-xs';

  if (kind === 'date' || kind === 'created_at') {
    const relative = isRelativeDate(value);
    const mode = relative ? value : 'date';
    return (
      <div className="flex items-center gap-1.5">
        <Select value={mode} onValueChange={(v) => v && onChange(v === 'date' ? '' : v)}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue>{relative ? t(`relative.${value}`) : t('relative.date')}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date">{t('relative.date')}</SelectItem>
            {RELATIVE_DATES.map((r) => (
              <SelectItem key={r} value={r}>
                {t(`relative.${r}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!relative && <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={base} />}
      </div>
    );
  }

  if (kind === 'number') {
    return (
      <Input type="number" inputMode="decimal" step="any" value={value} onChange={(e) => onChange(e.target.value)} className={base} />
    );
  }

  if (kind === 'enum' && field) {
    return (
      <CustomFieldInput
        field={{ field_name: field.field_name, field_type: 'enum', field_options: field.field_options as never }}
        value={value}
        onChange={onChange}
        className="h-8 text-xs"
      />
    );
  }

  if (kind === 'reference' && field?.field_options?.table_key) {
    return (
      <ReferencePicker tableKey={String(field.field_options.table_key)} value={value} onChange={onChange} className="text-xs" />
    );
  }

  return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('valuePlaceholder')} className={base} />;
}
