'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Plus, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { hasMinRole } from '@/lib/auth/roles';
import { SettingsPanelHead } from './settings-panel-head';
import { TableShapeDialog } from './table-shape-dialog';
import { TableRecords } from './table-records';
import type { CustomFieldRow, TableSummary } from '@/lib/custom-fields/server';

/**
 * Settings → Workspace → Custom tables.
 *
 * Lists the account's tables; "Open" shows a table's rows (add / edit /
 * delete), "Edit shape" changes its columns. A table can then be attached
 * to a custom field with the Reference type (Fields & tags).
 */
export function TablesPanel() {
  const t = useTranslations('Settings.tables');
  const { accountId, accountRole } = useAuth();
  const isAdmin = accountRole ? hasMinRole(accountRole, 'admin') : false;

  const [tables, setTables] = useState<TableSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [shape, setShape] = useState<
    { mode: 'create' } | { mode: 'edit'; table: TableSummary } | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/custom-tables', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(data.error ?? t('failed'));
      setTables((data.tables as TableSummary[] | undefined) ?? []);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [accountId, load]);

  const shapeDialog = shape ? (
    <TableShapeDialog
      mode={shape.mode}
      table={shape.mode === 'edit' ? shape.table : undefined}
      existingTables={tables}
      onClose={() => setShape(null)}
      onChanged={(deleted) => {
        if (deleted) setOpenId(null);
        void load();
      }}
    />
  ) : null;

  const open = tables.find((tb) => tb.id === openId);
  if (open) {
    return (
      <>
        <TableRecords
          table={open}
          isAdmin={isAdmin}
          canEditRows={
            accountRole ? hasMinRole(accountRole, open.min_role_edit) : false
          }
          onBack={() => {
            setOpenId(null);
            void load();
          }}
          onEditShape={() => setShape({ mode: 'edit', table: open })}
        />
        {shapeDialog}
      </>
    );
  }

  return (
    <div>
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          isAdmin ? (
            <Button size="sm" onClick={() => setShape({ mode: 'create' })}>
              <Plus className="size-4" />
              {t('newTable')}
            </Button>
          ) : undefined
        }
      />

      {loading ? (
        <div className="text-muted-foreground flex items-center justify-center py-12">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : tables.length === 0 ? (
        <div className="border-border rounded-lg border border-dashed py-12 text-center">
          <Table2 className="text-muted-foreground mx-auto mb-2 size-6" />
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        </div>
      ) : (
        <ul className="divide-border border-border divide-y rounded-lg border">
          {tables.map((tb) => (
            <li key={tb.id} className="flex items-center gap-3 px-4 py-3">
              <Table2 className="text-muted-foreground size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-sm font-medium">
                  {tb.name}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t('columnsCount', { count: tb.column_count })} ·{' '}
                  {t('rowsCount', { count: tb.row_count })}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpenId(tb.id)}
              >
                {t('open')}
              </Button>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShape({ mode: 'edit', table: tb })}
                >
                  {t('editShape')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {shapeDialog}
    </div>
  );
}

export type { CustomFieldRow };
