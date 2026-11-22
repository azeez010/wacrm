'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { CustomField } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GripVertical, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { FIELD_TYPES, MEDIA_ACCEPT_VALUES, type FieldType, type MediaAccept } from '@/lib/custom-fields/types';
import { useTranslations } from 'next-intl';

interface CustomFieldsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dialog wrapper around {@link CustomFieldsPanel}, used on the Contacts page.
 * The same panel is rendered inline under Settings → Custom Fields, so the
 * editing UI lives in one place. Radix unmounts the dialog content on close,
 * so the panel remounts (and refetches) on each open.
 */
export function CustomFieldsManager({
  open,
  onOpenChange,
}: CustomFieldsManagerProps) {
  const t = useTranslations('Contacts.customFields');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t('title')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('desc')}
          </DialogDescription>
        </DialogHeader>
        <CustomFieldsPanel />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Create / rename / reorder / delete account-wide custom contact field
 * definitions. Per-contact values are edited elsewhere (contact detail →
 * Custom Fields); this only manages the field catalogue. Writes go through
 * /api/custom-fields, which enforces the admin role, the plan feature and
 * the field limit, and validates the per-type options.
 */
export function CustomFieldsPanel() {
  const t = useTranslations('Contacts.customFields');
  const { accountId } = useAuth();

  const [fields, setFields] = useState<CustomField[]>([]);
  const [tables, setTables] = useState<{ id: string; key: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Create form
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<FieldType>('text');
  const [optionsText, setOptionsText] = useState('');
  const [tableKey, setTableKey] = useState('');
  const [numberFormat, setNumberFormat] = useState('plain');
  const [mediaAccept, setMediaAccept] = useState<MediaAccept>('any');
  const [creating, setCreating] = useState(false);

  const fetchFields = useCallback(async () => {
    setLoading(true);
    try {
      const [fRes, tRes] = await Promise.all([
        fetch('/api/custom-fields', { cache: 'no-store' }),
        fetch('/api/custom-tables', { cache: 'no-store' }),
      ]);
      const f = await fRes.json().catch(() => ({}));
      const tb = await tRes.json().catch(() => ({}));
      setFields((f.fields as CustomField[] | undefined) ?? []);
      setTables((tb.tables as { id: string; key: string; name: string }[] | undefined) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchFields();
    }
  }, [accountId, fetchFields]);

  function buildOptions(): Record<string, unknown> {
    if (newType === 'enum' || newType === 'multi_enum') {
      return {
        options: optionsText
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      };
    }
    if (newType === 'reference') return { table_key: tableKey };
    if (newType === 'number' && numberFormat !== 'plain') return { format: numberFormat };
    if (newType === 'media' && mediaAccept !== 'any') return { accept: mediaAccept };
    return {};
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    const res = await fetch('/api/custom-fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        type: newType,
        options: buildOptions(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setCreating(false);
    if (!res.ok) {
      toast.error(data.error ?? t('toastCreateFailed'));
      return;
    }
    toast.success(t('toastCreated', { name }));
    setNewName('');
    setOptionsText('');
    setTableKey('');
    setNumberFormat('plain');
    setMediaAccept('any');
    await fetchFields();
  }

  async function patchField(field: CustomField, patch: Record<string, unknown>): Promise<boolean> {
    setBusyId(field.id);
    const res = await fetch(`/api/custom-fields/${field.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      toast.error(data.error ?? t('toastRenameFailed'));
      return false;
    }
    return true;
  }

  /** Returns true on success so the row keeps the new name, false to revert. */
  async function handleRename(field: CustomField, nextName: string): Promise<boolean> {
    const name = nextName.trim();
    if (!name || name === field.field_name) return true;
    const ok = await patchField(field, { name });
    if (ok) await fetchFields();
    return ok;
  }

  const sensors = useSensors(
    // A small distance so a click on the grip (or a stray tap) doesn't start a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  /** Drop a row somewhere new: reorder locally right away, then save the new order. */
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = fields.findIndex((f) => f.id === active.id);
    const to = fields.findIndex((f) => f.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(fields, from, to);
    setFields(next);
    // Re-number the whole list so equal sort_orders can never stall a move.
    const results = await Promise.all(
      next.map((f, i) =>
        f.sort_order === i + 1
          ? Promise.resolve(true)
          : fetch(`/api/custom-fields/${f.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sort_order: i + 1 }),
            }).then((r) => r.ok)
      )
    );
    if (results.some((ok) => !ok)) toast.error(t('toastReorderFailed'));
    await fetchFields();
  }

  async function handleDelete(field: CustomField) {
    if (!window.confirm(t('deleteConfirm', { name: field.field_name }))) return;
    setBusyId(field.id);
    const res = await fetch(`/api/custom-fields/${field.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      toast.error(data.error ?? t('toastDeleteFailed'));
      return;
    }
    toast.success(
      data.archived
        ? t('toastArchived', { name: field.field_name })
        : t('toastDeleted', { name: field.field_name })
    );
    await fetchFields();
  }

  const needsOptions = newType === 'enum' || newType === 'multi_enum';
  const canCreate =
    !!newName.trim() &&
    !creating &&
    (!needsOptions || optionsText.trim().length > 0) &&
    (newType !== 'reference' || !!tableKey);

  return (
    <div className="space-y-4">
      {/* Create */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canCreate) {
                e.preventDefault();
                void handleCreate();
              }
            }}
            placeholder={t('fieldName')}
            className="bg-muted text-foreground"
          />
          <Select value={newType} onValueChange={(v) => v && setNewType(v as FieldType)}>
            <SelectTrigger className="w-36 shrink-0" aria-label={t('typeLabel')}>
              <SelectValue>{t(`types.${newType}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {FIELD_TYPES.map((ft) => (
                <SelectItem key={ft} value={ft}>
                  {t(`types.${ft}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={handleCreate}
            disabled={!canCreate}
            className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
          >
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {t('addField')}
          </Button>
        </div>

        {needsOptions && (
          <Input
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            placeholder={t('optionsPlaceholder')}
            aria-label={t('optionsLabel')}
            className="bg-muted text-foreground"
          />
        )}

        {newType === 'reference' && (
          <Select value={tableKey} onValueChange={(v) => setTableKey(v ?? '')}>
            <SelectTrigger aria-label={t('tableLabel')}>
              <SelectValue placeholder={tables.length ? t('tablePlaceholder') : t('noTables')}>
                {tables.find((tb) => tb.key === tableKey)?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {tables.map((tb) => (
                <SelectItem key={tb.id} value={tb.key}>
                  {tb.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {newType === 'media' && (
          <Select value={mediaAccept} onValueChange={(v) => v && setMediaAccept(v as MediaAccept)}>
            <SelectTrigger aria-label={t('acceptLabel')}>
              <SelectValue>{t(`accept.${mediaAccept}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MEDIA_ACCEPT_VALUES.map((a) => (
                <SelectItem key={a} value={a}>
                  {t(`accept.${a}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {newType === 'number' && (
          <Select value={numberFormat} onValueChange={(v) => v && setNumberFormat(v)}>
            <SelectTrigger aria-label={t('numberFormat')}>
              <SelectValue>{t(`formats.${numberFormat}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {['plain', 'currency', 'percent'].map((f) => (
                <SelectItem key={f} value={f}>
                  {t(`formats.${f}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* List */}
      <div className="max-h-72 overflow-y-auto rounded-md border border-border">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('loading')}
          </div>
        ) : fields.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              <ul className="divide-y divide-border">
                {fields.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    busy={busyId === field.id}
                    onRename={handleRename}
                    onDelete={handleDelete}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

/** A single editable row. Controlled local state lets us commit on blur /
 *  Enter and cleanly revert to the last saved name when a rename fails. */
function FieldRow({
  field,
  busy,
  onRename,
  onDelete,
}: {
  field: CustomField;
  busy: boolean;
  onRename: (field: CustomField, name: string) => Promise<boolean>;
  onDelete: (field: CustomField) => void;
}) {
  const t = useTranslations('Contacts.customFields');
  const [name, setName] = useState(field.field_name);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id });

  async function commit() {
    if (name.trim() === field.field_name) {
      setName(field.field_name); // normalise any whitespace-only edit
      return;
    }
    const ok = await onRename(field, name);
    if (!ok) setName(field.field_name);
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'relative flex items-center gap-1.5 bg-card px-1.5 py-1.5',
        isDragging && 'z-10 rounded-md shadow-lg ring-1 ring-primary/40'
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t('dragHandle', { name: field.field_name })}
        title={t('dragHint')}
        className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <Input
        value={name}
        disabled={busy || field.locked}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        aria-label={t('renameAria', { name: field.field_name })}
        className="focus:border-primary h-8 border-transparent bg-transparent text-foreground hover:border-border"
      />
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
        {t(`types.${field.field_type}`)}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy || field.locked}
        onClick={() => onDelete(field)}
        title={t('deleteTitle')}
        className="shrink-0 text-muted-foreground hover:text-red-400"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      </Button>
    </li>
  );
}
