'use client';

// "Show only if ..." editor for one form field: rules that look at the answers
// to fields ABOVE it. The rules are evaluated by lib/forms/conditions.ts, in the
// visitor's browser and again on the server.

import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import {
  MAX_CONDITION_RULES,
  OPS_WITH_VALUE,
  canBeConditionSource,
  type ConditionOp,
  type ConditionRule,
  type VisibleWhen,
} from '@/lib/forms/conditions';
import type { FormField } from '@/lib/forms/types';
import type { FormEditorData } from './use-form-data';

type SourceType = 'text' | 'number' | 'bool' | 'choice' | 'multi';

interface SourceInfo {
  type: SourceType;
  choices: string[];
  label: string;
}

const selectCls = 'h-8 w-full rounded-lg border border-border bg-muted px-2 text-sm text-foreground disabled:opacity-60';

const OPS_BY_TYPE: Record<SourceType, ConditionOp[]> = {
  text: ['eq', 'neq', 'contains', 'filled', 'empty'],
  number: ['eq', 'neq', 'gt', 'lt', 'filled', 'empty'],
  bool: ['eq'],
  choice: ['eq', 'neq', 'filled', 'empty'],
  multi: ['eq', 'neq', 'filled', 'empty'],
};

/** What kind of answer a field produces, and (for choices) which options it offers. */
function sourceInfo(f: FormField, data: FormEditorData, fallbackLabel: string): SourceInfo {
  const def =
    f.kind === 'custom_field'
      ? data.customFields.find((c) => c.id === f.customFieldId)
      : f.kind === 'table_column'
        ? data.tableColumns.find((c) => c.refFieldId === f.tableRef?.fieldId && c.column.key === f.tableRef?.columnKey)?.column
        : undefined;
  const label = f.label || def?.field_name || fallbackLabel;
  if (f.kind === 'consent') return { type: 'bool', choices: [], label };
  if (!def) return { type: 'text', choices: [], label };
  const all = def.field_options?.options ?? [];
  const choices = f.options && f.options.length > 0 ? f.options : all;
  switch (def.field_type) {
    case 'number':
      return { type: 'number', choices: [], label };
    case 'bool':
      return { type: 'bool', choices: [], label };
    case 'enum':
      return { type: 'choice', choices, label };
    case 'multi_enum':
      return { type: 'multi', choices, label };
    default:
      return { type: 'text', choices: [], label };
  }
}

const defaultRule = (fieldId: string, type: SourceType): ConditionRule => (type === 'bool' ? { fieldId, op: 'eq', value: 'true' } : { fieldId, op: 'filled' });

export function ConditionEditor({
  field,
  before,
  data,
  canEdit,
  onChange,
}: {
  field: FormField;
  /** The fields above this one (the only ones a rule may look at). */
  before: FormField[];
  data: FormEditorData;
  canEdit: boolean;
  onChange: (next: VisibleWhen | undefined) => void;
}) {
  const t = useTranslations('Forms.edit');
  const sources = before
    .filter((f) => canBeConditionSource(f.kind))
    .map((f) => ({ field: f, info: sourceInfo(f, data, t(`kind.${f.kind}`)) }));
  const when = field.visibleWhen;
  const infoFor = (id: string) => sources.find((s) => s.field.id === id)?.info;

  const setRule = (i: number, next: ConditionRule) => {
    if (!when) return;
    onChange({ ...when, rules: when.rules.map((r, j) => (j === i ? next : r)) });
  };

  const opLabel = (op: ConditionOp, type: SourceType) =>
    op === 'eq' && type === 'multi' ? t('opIncludes') : op === 'neq' && type === 'multi' ? t('opNotIncludes') : t(`op.${op}`);

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-2.5">
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={!!when}
          disabled={!canEdit || (sources.length === 0 && !when)}
          onCheckedChange={(on) => {
            if (!on) return onChange(undefined);
            const first = sources[0];
            if (first) onChange({ match: 'all', rules: [defaultRule(first.field.id, first.info.type)] });
          }}
        />
        {t('showOnlyIf')}
      </label>

      {sources.length === 0 && !when ? <p className="text-xs text-muted-foreground">{t('conditionNeedsEarlier')}</p> : null}

      {when ? (
        <div className="space-y-2">
          {when.rules.map((r, i) => {
            const info = infoFor(r.fieldId);
            const type = info?.type ?? 'text';
            const ops = OPS_BY_TYPE[type];
            const needsValue = OPS_WITH_VALUE.includes(r.op);
            return (
              <div key={i} className="space-y-1.5 rounded-md border border-border bg-card p-2">
                <div className="flex items-center gap-1.5">
                  <select
                    aria-label={t('conditionField')}
                    value={r.fieldId}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const s = sources.find((x) => x.field.id === e.target.value);
                      if (s) setRule(i, defaultRule(s.field.id, s.info.type));
                    }}
                    className={selectCls}
                  >
                    {!info ? <option value={r.fieldId}>{r.fieldId}</option> : null}
                    {sources.map((s) => (
                      <option key={s.field.id} value={s.field.id}>
                        {s.info.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => {
                      const rules = when.rules.filter((_, j) => j !== i);
                      onChange(rules.length ? { ...when, rules } : undefined);
                    }}
                    aria-label={t('conditionRemove')}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  {type !== 'bool' ? (
                    <select
                      aria-label={t('conditionOperator')}
                      value={r.op}
                      disabled={!canEdit}
                      onChange={(e) => setRule(i, { fieldId: r.fieldId, op: e.target.value as ConditionOp, value: OPS_WITH_VALUE.includes(e.target.value as ConditionOp) ? r.value : undefined })}
                      className={selectCls}
                    >
                      {ops.map((op) => (
                        <option key={op} value={op}>
                          {opLabel(op, type)}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {needsValue ? (
                    type === 'bool' ? (
                      <select aria-label={t('conditionValue')} value={r.value === 'false' ? 'false' : 'true'} disabled={!canEdit} onChange={(e) => setRule(i, { ...r, op: 'eq', value: e.target.value })} className={selectCls}>
                        <option value="true">{t('yes')}</option>
                        <option value="false">{t('no')}</option>
                      </select>
                    ) : (type === 'choice' || type === 'multi') && info ? (
                      <select aria-label={t('conditionValue')} value={r.value ?? ''} disabled={!canEdit} onChange={(e) => setRule(i, { ...r, value: e.target.value })} className={selectCls}>
                        <option value="">{t('conditionPick')}</option>
                        {info.choices.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        aria-label={t('conditionValue')}
                        type={type === 'number' ? 'number' : 'text'}
                        value={r.value ?? ''}
                        disabled={!canEdit}
                        onChange={(e) => setRule(i, { ...r, value: e.target.value })}
                        placeholder={t('conditionValuePlaceholder')}
                        className="h-8"
                      />
                    )
                  ) : null}
                </div>
                {needsValue && !(r.value ?? '').trim() ? <p className="text-xs text-amber-600">{t('conditionNeedsValue')}</p> : null}
              </div>
            );
          })}

          <div className="flex flex-wrap items-center justify-between gap-2">
            {when.rules.length < MAX_CONDITION_RULES ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!canEdit}
                onClick={() => {
                  const used = new Set(when.rules.map((r) => r.fieldId));
                  const next = sources.find((s) => !used.has(s.field.id)) ?? sources[0];
                  if (next) onChange({ ...when, rules: [...when.rules, defaultRule(next.field.id, next.info.type)] });
                }}
              >
                <Plus className="size-4" />
                {t('conditionAdd')}
              </Button>
            ) : (
              <span />
            )}
            {when.rules.length > 1 ? (
              <div className="w-44">
                <SegmentedControl
                  aria-label={t('conditionMatch')}
                  disabled={!canEdit}
                  value={when.match}
                  onChange={(match) => onChange({ ...when, match })}
                  options={[
                    { value: 'all', label: t('matchAll') },
                    { value: 'any', label: t('matchAny') },
                  ]}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
