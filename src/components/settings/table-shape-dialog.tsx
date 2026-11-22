'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FIELD_TYPES, MEDIA_ACCEPT_VALUES, type FieldType, type MediaAccept } from '@/lib/custom-fields/types';
import type { CustomFieldRow, TableSummary } from '@/lib/custom-fields/server';

interface DraftColumn {
  /** Set for columns that already exist (edit mode). */
  id?: string;
  name: string;
  type: FieldType;
  optionsText: string;
  tableKey: string;
  accept: MediaAccept;
}

const blank = (): DraftColumn => ({ name: '', type: 'text', optionsText: '', tableKey: '', accept: 'any' });

function optionsFor(c: DraftColumn): Record<string, unknown> {
  if (c.type === 'enum' || c.type === 'multi_enum') {
    return { options: c.optionsText.split(',').map((o) => o.trim()).filter(Boolean) };
  }
  if (c.type === 'reference') return { table_key: c.tableKey };
  if (c.type === 'media' && c.accept !== 'any') return { accept: c.accept };
  return {};
}

interface Props {
  mode: 'create' | 'edit';
  table?: TableSummary;
  existingTables: TableSummary[];
  onClose: () => void;
  /** `deleted` is true when the table itself was removed. */
  onChanged: (deleted?: boolean) => void;
}

/**
 * Create a table (name + columns in one go) or edit an existing table's
 * shape. In edit mode each column change is saved immediately through the
 * custom-fields API (columns are ordinary custom fields with a table_id).
 */
export function TableShapeDialog({ mode, table, existingTables, onClose, onChanged }: Props) {
  const t = useTranslations('Settings.tables.shape');
  const tf = useTranslations('Contacts.customFields');
  const tFail = useTranslations('Settings.tables');

  const [name, setName] = useState(table?.name ?? '');
  const [columns, setColumns] = useState<DraftColumn[]>(mode === 'create' ? [blank()] : []);
  const [labelKey, setLabelKey] = useState(table?.label_field_key ?? '');
  const [existing, setExisting] = useState<CustomFieldRow[]>([]);
  const [draft, setDraft] = useState<DraftColumn>(blank());
  const [loading, setLoading] = useState(mode === 'edit');
  const [busy, setBusy] = useState(false);

  async function loadColumns() {
    if (!table) return;
    const res = await fetch(`/api/custom-tables/${table.id}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    setExisting((data.columns as CustomFieldRow[] | undefined) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (mode === 'edit') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadColumns();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const otherTables = existingTables.filter((tb) => tb.id !== table?.id);

  async function api(url: string, init: RequestInit): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) toast.error((data.error as string | undefined) ?? tFail('failed'));
    return { ok: res.ok, data };
  }

  async function handleCreate() {
    setBusy(true);
    const { ok } = await api('/api/custom-tables', {
      method: 'POST',
      body: JSON.stringify({
        name,
        label_field_key: undefined,
        columns: columns.map((c) => ({ name: c.name, type: c.type, options: optionsFor(c) })),
      }),
    });
    setBusy(false);
    if (ok) {
      toast.success(tFail('toastTableCreated', { name: name.trim() }));
      onChanged();
      onClose();
    }
  }

  async function handleSaveName() {
    if (!table) return;
    const patch: Record<string, unknown> = {};
    if (name.trim() && name.trim() !== table.name) patch.name = name.trim();
    if (labelKey && labelKey !== table.label_field_key) patch.label_field_key = labelKey;
    if (Object.keys(patch).length === 0) return;
    setBusy(true);
    const { ok } = await api(`/api/custom-tables/${table.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    setBusy(false);
    if (ok) onChanged();
  }

  async function handleAddColumn() {
    if (!table || !draft.name.trim()) return;
    setBusy(true);
    const { ok } = await api('/api/custom-fields', {
      method: 'POST',
      body: JSON.stringify({
        name: draft.name,
        type: draft.type,
        options: optionsFor(draft),
        table_id: table.id,
      }),
    });
    setBusy(false);
    if (ok) {
      setDraft(blank());
      await loadColumns();
      onChanged();
    }
  }

  async function handleRenameColumn(col: CustomFieldRow, next: string) {
    if (!next.trim() || next.trim() === col.field_name) return;
    const { ok } = await api(`/api/custom-fields/${col.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: next.trim() }),
    });
    if (ok) await loadColumns();
  }

  async function handleDeleteColumn(col: CustomFieldRow) {
    if (!window.confirm(t('deleteColumnConfirm', { name: col.field_name }))) return;
    const { ok } = await api(`/api/custom-fields/${col.id}?purge=1`, { method: 'DELETE' });
    if (ok) {
      await loadColumns();
      onChanged();
    }
  }

  async function handleDeleteTable() {
    if (!table || !window.confirm(t('deleteTableConfirm', { name: table.name }))) return;
    setBusy(true);
    const { ok } = await api(`/api/custom-tables/${table.id}`, { method: 'DELETE' });
    setBusy(false);
    if (ok) {
      toast.success(tFail('toastTableDeleted', { name: table.name }));
      onChanged(true);
      onClose();
    }
  }

  const canCreate =
    !!name.trim() &&
    columns.length > 0 &&
    columns.every(
      (c) =>
        c.name.trim() &&
        (c.type !== 'reference' || c.tableKey) &&
        ((c.type !== 'enum' && c.type !== 'multi_enum') || c.optionsText.trim())
    );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-popover text-popover-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? t('createTitle') : t('editTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="table-name">{t('name')}</Label>
            <Input
              id="table-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={mode === 'edit' ? handleSaveName : undefined}
              placeholder={t('namePlaceholder')}
              className="bg-muted"
              disabled={table?.locked}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('columns')}</Label>
            {mode === 'create' ? (
              <>
                {columns.map((c, i) => (
                  <ColumnDraftRow
                    otherTables={otherTables}
                    key={i}
                    value={c}
                    onChange={(next) => setColumns((prev) => prev.map((p, j) => (j === i ? next : p)))}
                    onRemove={columns.length > 1 ? () => setColumns((prev) => prev.filter((_, j) => j !== i)) : undefined}
                  />
                ))}
                <Button type="button" variant="ghost" size="sm" onClick={() => setColumns((prev) => [...prev, blank()])}>
                  <Plus className="size-4" />
                  {t('addColumn')}
                </Button>
              </>
            ) : loading ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {existing.map((col) => (
                    <ExistingColumn
                      key={col.id}
                      col={col}
                      typeLabel={tf(`types.${col.field_type}`)}
                      isLabel={labelKey === col.key}
                      locked={Boolean(table?.locked)}
                      onRename={(n) => handleRenameColumn(col, n)}
                      onDelete={() => handleDeleteColumn(col)}
                      onMakeLabel={() => setLabelKey(col.key)}
                      labelText={t('labelColumn')}
                    />
                  ))}
                </ul>
                {!table?.locked && (
                  <div className="space-y-2 rounded-md border border-dashed border-border p-2">
                    <ColumnDraftRow value={draft} onChange={setDraft} otherTables={otherTables} />
                    <Button type="button" size="sm" variant="outline" onClick={handleAddColumn} disabled={busy || !draft.name.trim()}>
                      <Plus className="size-4" />
                      {t('addColumn')}
                    </Button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">{t('labelHint')}</p>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {mode === 'edit' && !table?.locked ? (
            <Button type="button" variant="ghost" className="text-red-400 hover:text-red-400" onClick={handleDeleteTable} disabled={busy}>
              {t('deleteTable')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {mode === 'create' ? t('cancel') : t('done')}
            </Button>
            {mode === 'create' ? (
              <Button type="button" onClick={handleCreate} disabled={busy || !canCreate}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {t('create')}
              </Button>
            ) : (
              <Button type="button" onClick={async () => { await handleSaveName(); onClose(); }} disabled={busy}>
                {t('save')}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ColumnDraftRow({
  value,
  onChange,
  onRemove,
  otherTables,
}: {
  value: DraftColumn;
  onChange: (c: DraftColumn) => void;
  onRemove?: () => void;
  otherTables: TableSummary[];
}) {
  const t = useTranslations('Settings.tables.shape');
const tf = useTranslations('Contacts.customFields');
  const needsOptions = value.type === 'enum' || value.type === 'multi_enum';
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Input
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder={t('columnName')}
          className="h-8 bg-muted text-sm"
        />
        <Select value={value.type} onValueChange={(v) => v && onChange({ ...value, type: v as FieldType })}>
          <SelectTrigger className="h-8 w-36 shrink-0 text-sm">
            <SelectValue>{tf(`types.${value.type}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((ft) => (
              <SelectItem key={ft} value={ft}>
                {tf(`types.${ft}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {onRemove && (
          <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} className="shrink-0 text-muted-foreground">
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
      {needsOptions && (
        <Input
          value={value.optionsText}
          onChange={(e) => onChange({ ...value, optionsText: e.target.value })}
          placeholder={tf('optionsPlaceholder')}
          className="h-8 bg-muted text-sm"
        />
      )}
      {value.type === 'media' && (
        <Select value={value.accept} onValueChange={(v) => v && onChange({ ...value, accept: v as MediaAccept })}>
          <SelectTrigger className="h-8 text-sm" aria-label={tf('acceptLabel')}>
            <SelectValue>{tf(`accept.${value.accept}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {MEDIA_ACCEPT_VALUES.map((a) => (
              <SelectItem key={a} value={a}>
                {tf(`accept.${a}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {value.type === 'reference' && (
        <Select value={value.tableKey} onValueChange={(v) => onChange({ ...value, tableKey: v ?? '' })}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={tf('tablePlaceholder')}>
              {otherTables.find((tb) => tb.key === value.tableKey)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {otherTables.map((tb) => (
              <SelectItem key={tb.id} value={tb.key}>
                {tb.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function ExistingColumn({
  col,
  typeLabel,
  isLabel,
  locked,
  labelText,
  onRename,
  onDelete,
  onMakeLabel,
}: {
  col: CustomFieldRow;
  typeLabel: string;
  isLabel: boolean;
  locked: boolean;
  labelText: string;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMakeLabel: () => void;
}) {
  const [name, setName] = useState(col.field_name);
  return (
    <li className="flex items-center gap-2 px-2 py-1.5">
      <Input
        value={name}
        disabled={locked}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => onRename(name)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="h-8 border-transparent bg-transparent text-sm hover:border-border"
      />
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{typeLabel}</span>
      <Button
        type="button"
        variant={isLabel ? 'secondary' : 'ghost'}
        size="sm"
        onClick={onMakeLabel}
        className="h-7 shrink-0 px-2 text-[11px]"
        aria-pressed={isLabel}
      >
        {labelText}
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onDelete} disabled={locked} className="shrink-0 text-muted-foreground hover:text-red-400">
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}
