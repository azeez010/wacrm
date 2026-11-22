'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { dedupeByPhone, isUniqueViolation, normalizeKey } from '@/lib/contacts/dedupe';
import { parseCsvGrid, type CsvGrid } from '@/lib/contacts/csv-grid';
import {
  applyMapping,
  autoMapWithTableNames,
  buildSystemFields,
  instructionHeaders,
  mappedCount,
  usedColumns,
  validateCustomValues,
  type ContactFieldInput,
  type Mapping,
  type PreparedRow,
} from '@/lib/contacts/import-mapping';
import { resolveTableGroups, tableRowKey } from '@/lib/contacts/import-tables';
import { inferFieldType } from '@/lib/contacts/import-custom-fields';
import { loadTableMeta, type TableMetaByKey } from '@/lib/contacts/column-cache';
import {
  assignImportedContactTags,
  resolveImportTagIds,
  type ContactTagAssignment,
} from '@/lib/contacts/resolve-import-tags';
import type { FieldDef } from '@/lib/custom-fields/types';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Upload, FileText, Loader2, CheckCircle, XCircle, AlertTriangle, Tag, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Tag as TagRow } from '@/types';
import { ImportMappingList } from './import-mapping-list';

const DEFAULT_TAG_COLOR = '#3b82f6';
const PREVIEW_LIMIT = 5;

function truncateFilename(name: string, max = 48): string {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, name.length - ext.length);
  const keep = max - ext.length - 1;
  return `${base.slice(0, Math.max(keep, 12))}…${ext}`;
}

function PreviewCell({ value, mono, maxWidth = 'max-w-[9rem]' }: { value: string; mono?: boolean; maxWidth?: string }) {
  return (
    <span className={cn('block truncate', maxWidth, mono && 'font-mono text-[11px]')} title={value}>
      {value}
    </span>
  );
}

function ImportPreviewTags({ tagNames, tagColorByKey }: { tagNames: string[]; tagColorByKey: Map<string, string> }) {
  const t = useTranslations('Contacts.importModal');
  if (tagNames.length === 0) return <span className="text-muted-foreground">-</span>;
  return (
    <div className="flex min-w-[4.5rem] flex-wrap gap-1">
      {tagNames.map((name) => {
        const key = name.trim().toLowerCase();
        const color = tagColorByKey.get(key) ?? DEFAULT_TAG_COLOR;
        const isKnown = tagColorByKey.has(key);
        return (
          <span
            key={name}
            className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] leading-none font-medium"
            style={{ backgroundColor: `${color}18`, color, border: `1px solid ${color}${isKnown ? '55' : '30'}` }}
            title={isKnown ? name : t('willBeCreated', { name })}
          >
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <span className="truncate">{name}</span>
          </span>
        );
      })}
    </div>
  );
}

interface ImportResult {
  imported: number;
  skipped: number;
  invalidPhone: number;
  failed: number;
  failedDetails: { phone: string; name?: string; reason: string }[];
  tagsAssigned: number;
  updated: number;
  tableRowsCreated: number;
  customErrors: { phone: string; field: string; reason: string }[];
}

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function ImportModal({ open, onOpenChange, onImported }: ImportModalProps) {
  const t = useTranslations('Contacts.importModal');
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // What the account has (loaded when the modal opens) ------------------
  const [fieldInputs, setFieldInputs] = useState<ContactFieldInput[]>([]);
  const [tableMeta, setTableMeta] = useState<TableMetaByKey>({});
  const [accountTags, setAccountTags] = useState<TagRow[]>([]);

  // The file and the mapping --------------------------------------------
  const [file, setFile] = useState<File | null>(null);
  const [grid, setGrid] = useState<CsvGrid | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [updateExisting, setUpdateExisting] = useState(false);
  const [createMissingRows, setCreateMissingRows] = useState(true);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const systemFields = useMemo(() => buildSystemFields(fieldInputs, tableMeta), [fieldInputs, tableMeta]);
  const prepared = useMemo<PreparedRow[]>(
    () => (grid ? applyMapping(grid, mapping, systemFields) : []),
    [grid, mapping, systemFields]
  );
  const hints = useMemo(() => instructionHeaders(systemFields), [systemFields]);
  const tagColorByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const tg of accountTags) {
      const k = tg.name.trim().toLowerCase();
      if (!m.has(k)) m.set(k, tg.color);
    }
    return m;
  }, [accountTags]);

  const phoneMapped = mapping.phone?.kind === 'column';
  const hasTableMapping = systemFields.some((f) => f.group === 'table' && mapping[f.id] && mapping[f.id]!.kind !== 'skip');

  // Load the field list, table columns and tags once per open (the table
  // metadata comes from the same cache the Contacts columns use).
  async function loadAccountData() {
    if (!accountId) return;
    const [fieldsRes, tagsRes] = await Promise.all([
      fetch('/api/custom-fields', { cache: 'no-store' }).then((r) => r.json().catch(() => ({}))),
      supabase.from('tags').select('*').eq('account_id', accountId),
    ]);
    const fields = ((fieldsRes.fields as ContactFieldInput[] | undefined) ?? []).filter((f) => !f.archived_at);
    setFieldInputs(fields);
    setAccountTags((tagsRes.data as TagRow[] | null) ?? []);
    const keys = fields
      .filter((f) => f.field_type === 'reference')
      .map((f) => (f.field_options as { table_key?: string } | undefined)?.table_key)
      .filter((k): k is string => !!k);
    if (keys.length > 0) {
      try {
        setTableMeta(await loadTableMeta(supabase, accountId, keys));
      } catch {
        /* table columns just won't be offered */
      }
    }
  }

  useEffect(() => {
    if (open && accountId) void loadAccountData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountId]);

  // If the account data arrives after a file was chosen, match columns again
  // (unless the user has already changed the mapping by hand).
  const mappingTouched = useRef(false);
  useEffect(() => {
    if (grid && !mappingTouched.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMapping(autoMapWithTableNames(grid.headers, systemFields));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemFields]);

  function reset() {
    setFile(null);
    setGrid(null);
    setMapping({});
    setUpdateExisting(false);
    setCreateMissingRows(true);
    setResult(null);
    mappingTouched.current = false;
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setResult(null);
    const parsed = parseCsvGrid(await selected.text());
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      toast.error(t('toastNoValidRows'));
      setGrid(null);
      setMapping({});
      return;
    }
    setGrid(parsed);
    setMapping(autoMapWithTableNames(parsed.headers, systemFields));
  }

  // Unmapped columns -----------------------------------------------------
  const used = useMemo(() => usedColumns(mapping), [mapping]);
  const unmapped = grid ? grid.headers.map((h, i) => ({ h, i })).filter(({ h, i }) => h && !used.has(i)) : [];

  async function createFieldFromColumn(index: number) {
    if (!grid) return;
    const header = grid.headers[index];
    const type = inferFieldType(grid.rows.slice(0, 50).map((r) => r[index] ?? ''));
    const res = await fetch('/api/custom-fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: header, type }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.field) {
      toast.warning(t('toastFieldNotCreated', { name: header, reason: data.error ?? '' }));
      return;
    }
    const created = data.field as ContactFieldInput;
    setFieldInputs((prev) => [...prev, created]);
    mappingTouched.current = true;
    setMapping((prev) => ({ ...prev, [`cf:${created.id}`]: { kind: 'column', index } }));
    toast.success(t('toastFieldCreated', { name: header }));
  }

  // The import -----------------------------------------------------------
  async function handleImport() {
    if (prepared.length === 0 || !phoneMapped) return;
    setImporting(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error(t('notAuthenticated'));
      if (!accountId) throw new Error(t('notLinkedToAccount'));

      let imported = 0;
      let skipped = 0;
      let failed = 0;
      const failedDetails: { phone: string; name?: string; reason: string }[] = [];

      // 1) De-dupe within the file by normalized phone (keep first). Rows with
      //    no usable phone at all are counted separately (they never duplicated anything).
      const { unique, duplicates: inFileDupes, invalid: invalidPhone } = dedupeByPhone(prepared);
      skipped += inFileDupes;

      // 2) Skip numbers already in this account (or update them when opted in).
      const { data: existingRows } = await supabase
        .from('contacts')
        .select('id, phone_normalized')
        .eq('account_id', accountId);
      const existingIdByPhone = new Map<string, string>();
      for (const r of (existingRows ?? []) as { id: string; phone_normalized: string | null }[]) {
        if (r.phone_normalized) existingIdByPhone.set(r.phone_normalized, r.id);
      }
      const toUpdate: { id: string; row: PreparedRow }[] = [];
      const toInsert = unique.filter((row) => {
        const existingId = existingIdByPhone.get(normalizeKey(row.phone));
        if (existingId) {
          if (updateExisting) toUpdate.push({ id: existingId, row });
          else skipped++;
          return false;
        }
        return true;
      });

      // 3) Custom field values (validated per row) and custom-table rows.
      const defsById = new Map<string, FieldDef>();
      for (const f of systemFields) if (f.group === 'custom' && f.def) defsById.set(f.def.id, f.def);
      const tableKeyByFieldId: Record<string, string> = {};
      for (const f of fieldInputs) {
        const key = (f.field_options as { table_key?: string } | undefined)?.table_key;
        if (f.field_type === 'reference' && key) tableKeyByFieldId[f.id] = key;
      }
      const tableResolution = hasTableMapping
        ? await resolveTableGroups({
            rows: [...toInsert, ...toUpdate.map((u) => u.row)],
            fields: systemFields,
            tableKeyByFieldId,
            createMissing: createMissingRows,
          })
        : null;

      const customErrors: { phone: string; field: string; reason: string }[] = [];
      const valueRows: Record<string, unknown>[] = [];
      const refFieldName = new Map(fieldInputs.map((f) => [f.id, f.field_name]));
      const planFor = (row: PreparedRow, contactId: string) => {
        const checked = validateCustomValues(row.custom, defsById, accountId);
        for (const issue of checked.issues) customErrors.push({ phone: row.phone, ...issue });
        for (const [fieldId, v] of Object.entries(checked.values)) {
          valueRows.push({ contact_id: contactId, custom_field_id: fieldId, account_id: accountId, ...v });
        }
        if (tableResolution) {
          for (const fieldId of Object.keys(row.tables)) {
            const name = refFieldName.get(fieldId) ?? fieldId;
            if (tableResolution.missingLabel.has(fieldId)) {
              customErrors.push({ phone: row.phone, field: name, reason: t('errorNoLabelColumn') });
              continue;
            }
            const labelField = systemFields.find((f) => f.refFieldId === fieldId && f.isLabel);
            const label = labelField?.columnKey ? row.tables[fieldId][labelField.columnKey] : undefined;
            if (!label) continue;
            const outcome = tableResolution.byKey.get(tableRowKey(fieldId, label));
            if (outcome?.id) {
              valueRows.push({
                contact_id: contactId,
                custom_field_id: fieldId,
                account_id: accountId,
                value: outcome.id,
                value_number: null,
                value_date: null,
                value_bool: null,
                value_text_array: null,
              });
            } else {
              customErrors.push({ phone: row.phone, field: name, reason: outcome?.error ?? t('errorTableRow') });
            }
          }
        }
      };
      let updated = 0;

      // 4) Resolve tag names → ids (admin+ may auto-create missing tags).
      const allTagNames = [...toInsert, ...toUpdate.map((u) => u.row)].flatMap((row) => row.tagNames);
      let tagIdByKey = new Map<string, string>();
      let skippedNames: string[] = [];
      if (allTagNames.length > 0) {
        ({ tagIdByKey, skippedNames } = await resolveImportTagIds(supabase, {
          accountId,
          userId: user.id,
          tagNames: allTagNames,
          canCreateTags: canEditSettings,
        }));
      }
      const tagAssignments: ContactTagAssignment[] = [];

      // 5) Batch insert the new contacts in chunks of 50. The DB unique index is
      //    the backstop: a 23505 counts as skipped, not failed.
      const chunkSize = 50;
      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const rows = chunk.map((row) => ({
          user_id: user.id,
          account_id: accountId,
          phone: row.phone,
          name: row.name || null,
          email: row.email || null,
          company: row.company || null,
          lead_source: row.lead_source || 'Import',
          utm_source: row.utm_source || null,
          utm_medium: row.utm_medium || null,
          utm_campaign: row.utm_campaign || null,
          first_seen_at: new Date().toISOString(),
          ...(row.blocked ? { blocked_at: new Date().toISOString(), blocked_reason: 'import', blocked_by: user.id } : {}),
        }));

        const { data, error } = await supabase.from('contacts').insert(rows).select('id');

        if (error) {
          // Retry individually so one bad/duplicate row doesn't sink the chunk.
          for (let j = 0; j < rows.length; j++) {
            const row = rows[j];
            const source = chunk[j];
            const { data: singleData, error: singleErr } = await supabase.from('contacts').insert(row).select('id').single();
            if (!singleErr && singleData) {
              imported++;
              planFor(source, singleData.id);
              if (source.tagNames.length > 0) tagAssignments.push({ contactId: singleData.id, tagNames: source.tagNames });
            } else if (isUniqueViolation(singleErr)) {
              skipped++;
            } else {
              failed++;
              console.error('[contacts import] insert failed for', row.phone, singleErr);
              failedDetails.push({
                phone: row.phone,
                name: row.name ?? undefined,
                reason: (singleErr as { message?: string } | null)?.message || t('unknownReason'),
              });
            }
          }
        } else {
          const inserted = data ?? [];
          imported += inserted.length;
          // inserted[j] ↔ chunk[j] only holds because a single INSERT preserves RETURNING order.
          for (let j = 0; j < inserted.length; j++) {
            const source = chunk[j];
            if (source) planFor(source, inserted[j].id);
            if (!source || source.tagNames.length === 0) continue;
            tagAssignments.push({ contactId: inserted[j].id, tagNames: source.tagNames });
          }
        }
      }

      // 5b) Update existing contacts (opt-in): only what the file provides changes.
      for (const { id, row } of toUpdate) {
        const patch: Record<string, string> = {};
        if (row.blocked) {
          patch.blocked_at = new Date().toISOString();
          patch.blocked_reason = 'import';
          patch.blocked_by = user.id;
        }
        if (row.name) patch.name = row.name;
        if (row.email) patch.email = row.email;
        if (row.company) patch.company = row.company;
        if (Object.keys(patch).length > 0) {
          const { error: upErr } = await supabase
            .from('contacts')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('id', id)
            .eq('account_id', accountId);
          if (upErr) {
            failed++;
            failedDetails.push({ phone: row.phone, name: row.name, reason: upErr.message });
            continue;
          }
        }
        planFor(row, id);
        if (row.tagNames.length > 0) tagAssignments.push({ contactId: id, tagNames: row.tagNames });
        updated++;
      }

      // 5c) Write all typed custom values in batches.
      for (let i = 0; i < valueRows.length; i += 200) {
        const { error: valErr } = await supabase
          .from('contact_custom_values')
          .upsert(valueRows.slice(i, i + 200), { onConflict: 'contact_id,custom_field_id' });
        if (valErr) {
          toast.warning(t('toastCustomValuesWarning'));
          break;
        }
      }

      // 6) Wire tags onto the contacts. Failure here must not mask a successful import.
      let tagsAssigned = 0;
      try {
        tagsAssigned = await assignImportedContactTags(supabase, tagAssignments, tagIdByKey);
      } catch {
        toast.warning(t('toastTagsWarning'));
      }

      setResult({
        imported,
        skipped,
        invalidPhone,
        failed,
        failedDetails,
        tagsAssigned,
        updated,
        tableRowsCreated: tableResolution?.createdCount ?? 0,
        customErrors,
      });
      if (imported > 0 || updated > 0) onImported();
      if (imported > 0) toast.success(t('toastImported', { count: imported }));
      if (updated > 0) toast.success(t('toastUpdated', { count: updated }));
      if (tagsAssigned > 0) toast.success(t('toastTagsAssigned', { count: tagsAssigned }));
      if (skippedNames.length > 0) {
        const sample = skippedNames.slice(0, 3).join(', ');
        const more = skippedNames.length > 3 ? t('toastTagsSkippedMore', { count: skippedNames.length - 3 }) : '';
        toast.info(t('toastTagsSkipped', { sample, more }));
      }
      if (skipped > 0) toast.info(t('toastSkipped', { count: skipped }));
      if (invalidPhone > 0) toast.warning(t('toastInvalidPhone', { count: invalidPhone }));
      if (failed > 0) toast.error(t('toastFailed', { count: failed }));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('toastError'));
    } finally {
      setImporting(false);
    }
  }

  const preview = prepared.slice(0, PREVIEW_LIMIT);
  const previewHasCompany = preview.some((r) => r.company);
  const previewHasTags = preview.some((r) => r.tagNames.length > 0);
  const otherMapped = Math.max(0, mappedCount(mapping) - ['phone', 'name', 'email', 'company', 'tags'].filter((k) => mapping[k as keyof Mapping] && mapping[k as keyof Mapping]!.kind !== 'skip').length);
  const tagStats = useMemo(() => {
    const names = new Set<string>();
    let rowsWithTags = 0;
    for (const row of prepared) {
      if (row.tagNames.length === 0) continue;
      rowsWithTags++;
      for (const name of row.tagNames) names.add(name.trim().toLowerCase());
    }
    return { unique: names.size, rowsWithTags };
  }, [prepared]);

  // One flat list: your fields, then every column of every table field (field.column).
  const fieldHeaders = [...hints.custom, ...hints.table];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[min(92vh,820px)] flex-col gap-0 overflow-hidden border-border/80 bg-popover p-0 text-popover-foreground sm:max-w-2xl">
        <div className="shrink-0 space-y-4 border-b border-border/80 px-6 pt-6 pb-5">
          <DialogHeader className="gap-1.5">
            <DialogTitle className="text-lg text-popover-foreground">{t('title')}</DialogTitle>
            {/* The instructions only matter before a file is chosen; afterwards the room goes to the mapping. */}
            {!grid && (
              <DialogDescription className="leading-relaxed text-muted-foreground">
                {t('instr.required')} <Code>phone</Code>. {t('instr.optional')} <Code>name</Code> <Code>email</Code>{' '}
                <Code>company</Code> <Code>tags</Code>
                {fieldHeaders.length > 0 && <> {t('instr.yourFields')} </>}
                {fieldHeaders.map((h) => (
                  <span key={h}>
                    <Code>{h}</Code>{' '}
                  </span>
                ))}
              </DialogDescription>
            )}
          </DialogHeader>

          {grid && file ? (
            <div className="flex items-center gap-3 rounded-xl border border-primary/35 bg-primary/[0.04] px-3 py-2">
              <div className="bg-primary/15 ring-primary/25 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1">
                <FileText className="text-primary size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-popover-foreground" title={file.name}>
                  {truncateFilename(file.name)}
                </p>
                <p className="text-[11px] text-muted-foreground">{t('rowsReady', { count: grid.rows.length })}</p>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="shrink-0 text-xs text-primary hover:underline disabled:opacity-50"
              >
                {t('chooseAnother')}
              </button>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
              className="group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 bg-background/40 p-5 transition-all hover:border-primary/40 hover:bg-background/70"
            >
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted/80 ring-1 ring-border/80 transition-colors group-hover:bg-muted">
                <Upload className="size-5 text-muted-foreground group-hover:text-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">{t('uploadDropzone')}</p>
              <p className="text-[11px] text-muted-foreground">{t('uploadHint')}</p>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} className="hidden" />
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {grid && !result && (
            <>
              <section className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{t('map.title')}</p>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span>{t('map.summary', { mapped: used.size, total: grid.headers.filter(Boolean).length })}</span>
                    <button
                      type="button"
                      className="hover:text-foreground"
                      onClick={() => {
                        mappingTouched.current = false;
                        setMapping(autoMapWithTableNames(grid.headers, systemFields));
                      }}
                    >
                      {t('map.reset')}
                    </button>
                  </div>
                </div>
                <ImportMappingList
                  fields={systemFields}
                  headers={grid.headers}
                  samples={grid.headers.map((_, i) => grid.rows.slice(0, 3).map((r) => r[i] ?? ''))}
                  mapping={mapping}
                  onChange={(m) => {
                    mappingTouched.current = true;
                    setMapping(m);
                  }}
                  tags={accountTags}
                  disabled={importing}
                />
                {!phoneMapped && <p className="text-xs text-red-400">{t('map.phoneRequired')}</p>}
              </section>

              {unmapped.length > 0 && (
                <section className="space-y-1.5">
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{t('map.notImported')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {unmapped.map(({ h, i }) =>
                      canEditSettings ? (
                        <button
                          key={i}
                          type="button"
                          onClick={() => void createFieldFromColumn(i)}
                          title={t('map.createFieldHint', { name: h })}
                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                        >
                          <Plus className="size-3" />
                          {h}
                        </button>
                      ) : (
                        <span key={i} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {h}
                        </span>
                      )
                    )}
                  </div>
                  {canEditSettings && <p className="text-[11px] text-muted-foreground">{t('map.createFieldNote')}</p>}
                </section>
              )}

              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    {t('preview', { count: preview.length })}
                  </p>
                  {tagStats.rowsWithTags > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/90 px-2 py-0.5 text-[11px] text-muted-foreground">
                      <Tag className="text-primary/80 size-3" />
                      {t('previewTags', { tags: tagStats.unique, contacts: tagStats.rowsWithTags })}
                    </span>
                  )}
                </div>
                <div className="overflow-hidden rounded-xl border border-border ring-1 ring-border/50">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[32rem] text-xs">
                      <thead>
                        <tr className="border-b border-border bg-background/60">
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">{t('columns.phone')}</th>
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">{t('columns.name')}</th>
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">{t('columns.email')}</th>
                          {previewHasCompany && <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">{t('columns.company')}</th>}
                          {previewHasTags && <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">{t('columns.tags')}</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/70">
                        {preview.map((row, i) => (
                          <tr key={i} className="bg-popover/40 transition-colors hover:bg-muted/30">
                            <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                              <PreviewCell value={row.phone || '-'} mono maxWidth="max-w-[7.5rem]" />
                            </td>
                            <td className="px-3 py-2 text-popover-foreground">
                              <PreviewCell value={row.name || '-'} maxWidth="max-w-[8.5rem]" />
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              <PreviewCell value={row.email || '-'} maxWidth="max-w-[10rem]" />
                            </td>
                            {previewHasCompany && (
                              <td className="px-3 py-2 text-muted-foreground">
                                <PreviewCell value={row.company || '-'} maxWidth="max-w-[7rem]" />
                              </td>
                            )}
                            {previewHasTags && (
                              <td className="px-3 py-2 align-top">
                                <ImportPreviewTags tagNames={row.tagNames} tagColorByKey={tagColorByKey} />
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {otherMapped > 0 && <p className="text-[11px] text-muted-foreground">{t('map.otherMapped', { count: otherMapped })}</p>}
                {prepared.length > PREVIEW_LIMIT && (
                  <p className="text-center text-[11px] text-muted-foreground">{t('moreRows', { count: prepared.length - PREVIEW_LIMIT })}</p>
                )}
              </section>

              <section className="space-y-3">
                <label className="flex cursor-pointer items-start gap-2 text-sm text-popover-foreground">
                  <Checkbox checked={updateExisting} onCheckedChange={(c) => setUpdateExisting(c === true)} className="mt-0.5" />
                  <span>
                    {t('updateExisting')}
                    <span className="block text-[11px] text-muted-foreground">{t('updateExistingHint')}</span>
                  </span>
                </label>
                {hasTableMapping && (
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-popover-foreground">
                    <Checkbox checked={createMissingRows} onCheckedChange={(c) => setCreateMissingRows(c === true)} className="mt-0.5" />
                    <span>
                      {t('map.createMissing')}
                      <span className="block text-[11px] text-muted-foreground">{t('map.createMissingHint')}</span>
                    </span>
                  </label>
                )}
              </section>
            </>
          )}

          {result && (
            <div className="rounded-xl border border-border bg-background/50 p-4">
              <p className="text-sm font-medium text-popover-foreground">{t('importComplete')}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {result.imported > 0 && (
                  <div className="text-primary flex items-center gap-1.5 text-sm">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultImported', { count: result.imported })}
                  </div>
                )}
                {result.updated > 0 && (
                  <div className="text-primary flex items-center gap-1.5 text-sm">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultUpdated', { count: result.updated })}
                  </div>
                )}
                {result.tagsAssigned > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-cyan-400">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultTags', { count: result.tagsAssigned })}
                  </div>
                )}
                {result.tableRowsCreated > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-cyan-400">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultTableRows', { count: result.tableRowsCreated })}
                  </div>
                )}
                {result.skipped > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-amber-400">
                    <AlertTriangle className="size-4 shrink-0" />
                    {t('resultSkipped', { count: result.skipped })}
                  </div>
                )}
                {result.invalidPhone > 0 && (
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-sm text-amber-400">
                      <AlertTriangle className="size-4 shrink-0" />
                      {t('resultInvalidPhone', { count: result.invalidPhone })}
                    </div>
                    <p className="pl-[1.375rem] text-xs text-muted-foreground">{t('invalidPhoneHint')}</p>
                  </div>
                )}
                {result.failed > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-red-400">
                    <XCircle className="size-4 shrink-0" />
                    {t('resultFailed', { count: result.failed })}
                  </div>
                )}
              </div>

              {result.customErrors.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-border/80 pt-3">
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    {t('customErrorsHeading', { count: result.customErrors.length })}
                  </p>
                  <ul className="max-h-32 space-y-1 overflow-y-auto text-xs">
                    {result.customErrors.slice(0, 50).map((e, i) => (
                      <li key={i} className="flex items-baseline gap-2 text-muted-foreground">
                        <span className="shrink-0 font-mono text-popover-foreground">{e.phone}</span>
                        <span className="truncate">{e.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.failedDetails.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-border/80 pt-3">
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{t('failedRowsHeading')}</p>
                  <ul className="max-h-32 space-y-1 overflow-y-auto text-xs">
                    {result.failedDetails.map((row, i) => (
                      <li key={i} className="flex items-baseline gap-2 text-muted-foreground">
                        <span className="shrink-0 font-mono text-popover-foreground">{row.name ? `${row.name} (${row.phone})` : row.phone}</span>
                        <span className="truncate">{row.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mt-0 shrink-0 gap-2 border-t border-border/80 bg-background/50 px-6 py-4 sm:justify-end">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} className="border-border text-muted-foreground hover:bg-muted">
            {result ? t('close') : t('cancel')}
          </Button>
          {!result && (
            <Button
              type="button"
              disabled={prepared.length === 0 || importing || !phoneMapped}
              onClick={handleImport}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              {t('importBtn', { count: prepared.length })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">{children}</code>;
}
