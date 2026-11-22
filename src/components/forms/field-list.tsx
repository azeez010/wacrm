'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { FormField } from '@/lib/forms/types';
import type { EditorAction } from './editor-state';
import type { FormEditorData } from './use-form-data';

interface Props {
  fields: FormField[];
  data: FormEditorData;
  qualifyOn: boolean;
  canEdit: boolean;
  dispatch: (a: EditorAction) => void;
}

/** Field list: drag to reorder, one "+ Add field" menu, tiny inline editor per field. */
export function FieldList({ fields, data, qualifyOn, canEdit, dispatch }: Props) {
  const t = useTranslations('Forms.edit');
  const [open, setOpen] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = fields.findIndex((f) => f.id === e.active.id);
    const to = fields.findIndex((f) => f.id === e.over!.id);
    dispatch({ type: 'move', from, to });
  }

  const usedCustom = new Set(fields.flatMap((f) => (f.customFieldId ? [f.customFieldId] : [])));
  const usedCols = new Set(fields.flatMap((f) => (f.tableRef ? [`${f.tableRef.fieldId}:${f.tableRef.columnKey}`] : [])));
  const has = (kind: FormField['kind']) => fields.some((f) => f.kind === kind);
  const add = (field: FormField) => {
    dispatch({ type: 'add', field });
    setOpen(null);
  };

  return (
    <div className="space-y-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {fields.map((f) => (
              <FieldCard
                key={f.id}
                field={f}
                data={data}
                qualifyOn={qualifyOn}
                canEdit={canEdit}
                expanded={open === f.id}
                onToggle={() => setOpen(open === f.id ? null : f.id)}
                dispatch={dispatch}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <DropdownMenu>
        <DropdownMenuTrigger disabled={!canEdit} render={<Button variant="outline" size="sm" className="w-full border-dashed" />}>
          <Plus className="size-4" />
          {t('addField')}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('groupBasic')}</DropdownMenuLabel>
            {!has('name') && <DropdownMenuItem onClick={() => add({ id: 'name', kind: 'name' })}>{t('kind.name')}</DropdownMenuItem>}
            {!has('email') && <DropdownMenuItem onClick={() => add({ id: 'email', kind: 'email' })}>{t('kind.email')}</DropdownMenuItem>}
            {!has('company') && <DropdownMenuItem onClick={() => add({ id: 'company', kind: 'company' })}>{t('kind.company')}</DropdownMenuItem>}
            {!has('message') && <DropdownMenuItem onClick={() => add({ id: 'message', kind: 'message' })}>{t('kind.message')}</DropdownMenuItem>}
          </DropdownMenuGroup>
          {data.customFields.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('groupYourFields')}</DropdownMenuLabel>
              {data.customFields
                .filter((c) => !usedCustom.has(c.id))
                .map((c) => (
                  <DropdownMenuItem key={c.id} onClick={() => add({ id: `cf_${c.key}`, kind: 'custom_field', customFieldId: c.id, label: c.field_name })}>
                    {c.field_name}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuGroup>
          )}
          {data.tableColumns.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('groupTables')}</DropdownMenuLabel>
              {data.tableColumns
                .filter((c) => !usedCols.has(`${c.refFieldId}:${c.column.key}`))
                .map((c) => (
                  <DropdownMenuItem
                    key={`${c.refFieldId}:${c.column.key}`}
                    onClick={() =>
                      add({ id: `tb_${c.column.key}`, kind: 'table_column', tableRef: { fieldId: c.refFieldId, columnKey: c.column.key }, label: c.column.field_name })
                    }
                  >
                    {c.tableName} / {c.column.field_name}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuGroup>
          )}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('groupExtras')}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => add({ id: 'tags', kind: 'tag_picker', label: t('kind.tag_picker'), tagIds: [] })}>{t('kind.tag_picker')}</DropdownMenuItem>
            {!has('consent') && <DropdownMenuItem onClick={() => add({ id: 'consent', kind: 'consent', required: true, consentText: t('defaultConsent') })}>{t('kind.consent')}</DropdownMenuItem>}
            <DropdownMenuItem onClick={() => add({ id: 'hidden', kind: 'hidden', label: t('kind.hidden'), param: 'ad_id' })}>{t('kind.hidden')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => add({ id: 'heading', kind: 'heading', text: t('defaultHeading') })}>{t('kind.heading')}</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function FieldCard({
  field,
  data,
  qualifyOn,
  canEdit,
  expanded,
  onToggle,
  dispatch,
}: {
  field: FormField;
  data: FormEditorData;
  qualifyOn: boolean;
  canEdit: boolean;
  expanded: boolean;
  onToggle: () => void;
  dispatch: (a: EditorAction) => void;
}) {
  const t = useTranslations('Forms.edit');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const locked = field.kind === 'phone';
  const patch = (p: Partial<FormField>) => dispatch({ type: 'update', id: field.id, patch: p });

  const def =
    field.kind === 'custom_field'
      ? data.customFields.find((c) => c.id === field.customFieldId)
      : field.kind === 'table_column'
        ? data.tableColumns.find((c) => c.refFieldId === field.tableRef?.fieldId && c.column.key === field.tableRef?.columnKey)?.column
        : undefined;
  const missing = (field.kind === 'custom_field' || field.kind === 'table_column') && !def;
  const title = field.label || def?.field_name || (field.kind === 'heading' ? field.text : t(`kind.${field.kind}`));
  const choices = def && (def.field_type === 'enum' || def.field_type === 'multi_enum') ? def.field_options?.options ?? [] : [];
  const selected = field.options && field.options.length > 0 ? field.options : choices;

  return (
    <li ref={setNodeRef} style={style} className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 p-2">
        <button type="button" {...attributes} {...listeners} disabled={!canEdit} className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing" aria-label={t('drag')}>
          <GripVertical className="size-4" />
        </button>
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={expanded}>
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{t(`kind.${field.kind}`)}</span>
          {missing ? <span className="shrink-0 text-xs text-amber-600">{t('fieldMissing')}</span> : null}
          {field.required || locked ? <span className="text-red-500">*</span> : null}
        </button>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
      </div>
      {expanded && (
        <div className="space-y-3 border-t border-border p-3">
          {field.kind !== 'heading' && field.kind !== 'hidden' && field.kind !== 'consent' && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t('label')}</Label>
              <Input value={field.label ?? ''} disabled={!canEdit} onChange={(e) => patch({ label: e.target.value })} className="h-8" />
            </div>
          )}
          {field.kind === 'heading' && (
            <Textarea value={field.text ?? ''} disabled={!canEdit} onChange={(e) => patch({ text: e.target.value })} rows={2} />
          )}
          {field.kind === 'hidden' && (
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t('hiddenParam')}</Label>
                <Input value={field.param ?? ''} disabled={!canEdit} onChange={(e) => patch({ param: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })} className="h-8" />
                <p className="text-xs text-muted-foreground">{t('hiddenHint')}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t('hiddenFixed')}</Label>
                <Input value={field.fixedValue ?? ''} disabled={!canEdit} onChange={(e) => patch({ fixedValue: e.target.value })} className="h-8" />
              </div>
            </div>
          )}
          {field.kind === 'consent' && (
            <div className="space-y-2">
              <Textarea value={field.consentText ?? ''} disabled={!canEdit} onChange={(e) => patch({ consentText: e.target.value })} rows={2} />
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t('privacyUrl')}</Label>
                <Input value={field.privacyUrl ?? ''} disabled={!canEdit} onChange={(e) => patch({ privacyUrl: e.target.value || undefined })} placeholder="https://" className="h-8" />
              </div>
            </div>
          )}
          {(field.kind === 'name' || field.kind === 'email' || field.kind === 'company' || field.kind === 'message' || field.kind === 'custom_field' || field.kind === 'table_column') && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t('help')}</Label>
              <Input value={field.help ?? ''} disabled={!canEdit} onChange={(e) => patch({ help: e.target.value || undefined })} className="h-8" />
            </div>
          )}
          {field.kind === 'tag_picker' && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t('tagChoices')}</Label>
              <div className="flex flex-wrap gap-1.5">
                {data.tags.map((tg) => {
                  const on = (field.tagIds ?? []).includes(tg.id);
                  return (
                    <button
                      key={tg.id}
                      type="button"
                      disabled={!canEdit}
                      aria-pressed={on}
                      onClick={() => patch({ tagIds: on ? (field.tagIds ?? []).filter((x) => x !== tg.id) : [...(field.tagIds ?? []), tg.id] })}
                      className={cn('rounded-full border px-2.5 py-1 text-xs', on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}
                    >
                      {tg.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {choices.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t('choices')}</Label>
              {choices.map((o) => {
                const on = selected.some((s) => s.toLowerCase() === o.toLowerCase());
                return (
                  <div key={o} className="flex items-center gap-2 text-sm">
                    <label className="flex flex-1 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!canEdit}
                        onChange={(e) => {
                          const next = e.target.checked ? [...selected, o] : selected.filter((s) => s.toLowerCase() !== o.toLowerCase());
                          patch({ options: next.length === choices.length ? undefined : next });
                        }}
                      />
                      {o}
                    </label>
                    {qualifyOn && on && (
                      <>
                        <Input
                          type="number"
                          aria-label={t('points')}
                          value={field.points?.[o] ?? 0}
                          disabled={!canEdit}
                          onChange={(e) => patch({ points: { ...(field.points ?? {}), [o]: Number(e.target.value) || 0 } })}
                          className="h-7 w-16"
                        />
                        <label className="flex items-center gap-1 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={(field.disqualify ?? []).includes(o)}
                            disabled={!canEdit}
                            onChange={(e) => patch({ disqualify: e.target.checked ? [...(field.disqualify ?? []), o] : (field.disqualify ?? []).filter((x) => x !== o) })}
                          />
                          {t('disqualify')}
                        </label>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-between">
            {!locked && field.kind !== 'heading' && field.kind !== 'hidden' ? (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={!!field.required} disabled={!canEdit} onCheckedChange={(on) => patch({ required: on })} />
                {t('required')}
              </label>
            ) : (
              <span className="text-xs text-muted-foreground">{locked ? t('phoneLocked') : ''}</span>
            )}
            {!locked && (
              <Button variant="ghost" size="sm" disabled={!canEdit} onClick={() => dispatch({ type: 'remove', id: field.id })} className="text-destructive">
                <Trash2 className="size-4" />
                {t('remove')}
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
