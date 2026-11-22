'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
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
import { CustomFieldInput } from '@/components/custom-fields/custom-field-input';
import { useAuth } from '@/hooks/use-auth';
import { MediaCell } from '@/components/custom-fields/media-cell';
import { LinkCell, isLinkType } from '@/components/custom-fields/link-cell';
import { formatFieldValue } from '@/lib/custom-fields/format';
import type { FieldDef } from '@/lib/custom-fields/types';
import type { CustomFieldRow, RecordRow, TableSummary } from '@/lib/custom-fields/server';
import { SettingsPanelHead } from './settings-panel-head';

const PAGE = 25;

/** Stored row data → the canonical strings the inputs and API exchange. */
function toCanonical(col: CustomFieldRow, raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (Array.isArray(raw)) return raw.length ? JSON.stringify(raw) : '';
  return String(raw);
}

interface Props {
  table: TableSummary;
  isAdmin: boolean;
  canEditRows: boolean;
  onBack: () => void;
  onEditShape: () => void;
}

/** Rows of one custom table: search, add, edit, delete. */
export function TableRecords({ table, isAdmin, canEditRows, onBack, onEditShape }: Props) {
  const { accountTimezone } = useAuth();
  const t = useTranslations('Settings.tables.rows');
  const tTables = useTranslations('Settings.tables');

  const [columns, setColumns] = useState<CustomFieldRow[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<RecordRow | 'new' | null>(null);

  const loadColumns = useCallback(async () => {
    const res = await fetch(`/api/custom-tables/${table.id}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    setColumns((data.columns as CustomFieldRow[] | undefined) ?? []);
  }, [table.id]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
    if (search.trim()) q.set('search', search.trim());
    const res = await fetch(`/api/custom-tables/${table.id}/records?${q}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) toast.error(data.error ?? tTables('failed'));
    setRecords((data.records as RecordRow[] | undefined) ?? []);
    setTotal((data.total as number | undefined) ?? 0);
    setLoading(false);
  }, [table.id, page, search, tTables]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadColumns();
  }, [loadColumns]);

  useEffect(() => {
    const handle = setTimeout(() => void loadRows(), search ? 250 : 0);
    return () => clearTimeout(handle);
  }, [loadRows, search]);

  async function handleDelete(rec: RecordRow) {
    let used = 0;
    const usage = await fetch(`/api/custom-tables/${table.id}/records/${rec.id}`);
    if (usage.ok) used = ((await usage.json().catch(() => ({}))) as { used_by_contacts?: number }).used_by_contacts ?? 0;
    const message = used > 0 ? t('deleteUsedConfirm', { count: used }) : t('deleteConfirm');
    if (!window.confirm(message)) return;
    const res = await fetch(`/api/custom-tables/${table.id}/records/${rec.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? tTables('failed'));
      return;
    }
    toast.success(t('toastDeleted'));
    void loadRows();
  }

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {tTables('back')}
      </button>
      <SettingsPanelHead
        title={table.name}
        description={table.description ?? undefined}
        action={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={onEditShape}>
                {tTables('editShape')}
              </Button>
            )}
            {canEditRows && (
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus className="size-4" />
                {t('addRow')}
              </Button>
            )}
          </div>
        }
      />

      <div className="relative mb-3 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder={t('search')}
          className="bg-muted pl-8"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th key={c.id} className="max-w-[180px] truncate px-3 py-2 font-medium">
                  {c.field_name}
                </th>
              ))}
              <th className="w-20 px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={columns.length + 1} className="py-10 text-center">
                  <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" />
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="py-10 text-center text-sm text-muted-foreground">
                  {t('noRows')}
                </td>
              </tr>
            ) : (
              records.map((rec) => (
                <tr key={rec.id} className="hover:bg-muted/30">
                  {columns.map((c) => (
                    <td key={c.id} className="max-w-[180px] truncate px-3 py-2 text-foreground">
                      {c.field_type === 'media' ? (
                        <MediaCell value={toCanonical(c, rec.data[c.key])} />
                      ) : isLinkType(c.field_type) ? (
                        <LinkCell type={c.field_type} value={toCanonical(c, rec.data[c.key])} />
                      ) : c.field_type === 'reference' ? (
                        <ReferenceCell tableKey={c.field_options?.table_key} id={toCanonical(c, rec.data[c.key])} />
                      ) : (
                        formatFieldValue(
                          c as FieldDef,
                          toCanonical(c, rec.data[c.key]),
                          { yes: t('yes'), no: t('no'), timeZone: accountTimezone }
                        )
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right">
                    {canEditRows && (
                      <>
                        <Button variant="ghost" size="icon-sm" onClick={() => setEditing(rec)} title={t('edit')}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleDelete(rec)}
                          title={t('delete')}
                          className="text-muted-foreground hover:text-red-400"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE && (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>{t('pageOf', { page: page + 1, pages })}</span>
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            {t('prev')}
          </Button>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
            {t('next')}
          </Button>
        </div>
      )}
      {!canEditRows && <p className="mt-3 text-xs text-muted-foreground">{t('readOnly')}</p>}

      {editing && (
        <RecordDialog
          tableId={table.id}
          columns={columns}
          record={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void loadRows();
          }}
        />
      )}
    </div>
  );
}

const labelCache = new Map<string, string>();

/** Label of a referenced row (fetched once per id, then cached). */
function ReferenceCell({ tableKey, id }: { tableKey?: string; id: string }) {
  const [label, setLabel] = useState(labelCache.get(id) ?? '');
  useEffect(() => {
    if (!id || !tableKey || labelCache.has(id)) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/custom-tables/${encodeURIComponent(tableKey)}/records?ids=${id}`);
      const data = await res.json().catch(() => ({}));
      const hit = (data.records as { id: string; label: string }[] | undefined)?.find((r) => r.id === id);
      if (hit) labelCache.set(id, hit.label);
      if (!cancelled) setLabel(hit?.label ?? '');
    })();
    return () => {
      cancelled = true;
    };
  }, [id, tableKey]);
  return <>{label}</>;
}

function RecordDialog({
  tableId,
  columns,
  record,
  onClose,
  onSaved,
}: {
  tableId: string;
  columns: CustomFieldRow[];
  record: RecordRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('Settings.tables.rows');
  const tTables = useTranslations('Settings.tables');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(columns.map((c) => [c.key, toCanonical(c, record?.data[c.key])]))
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const url = record
      ? `/api/custom-tables/${tableId}/records/${record.id}`
      : `/api/custom-tables/${tableId}/records`;
    const res = await fetch(url, {
      method: record ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error ?? tTables('failed'));
      return;
    }
    toast.success(t('toastSaved'));
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{record ? t('editRow') : t('newRow')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {columns.map((c) => (
            <div key={c.id} className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {c.field_name}
                {c.required ? ' *' : ''}
              </Label>
              <CustomFieldInput
                field={{
                  field_name: c.field_name,
                  field_type: c.field_type,
                  field_options: c.field_options,
                }}
                value={values[c.key] ?? ''}
                onChange={(v) => setValues((prev) => ({ ...prev, [c.key]: v }))}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
