'use client';

import { useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  dedupeByPhone,
  isUniqueViolation,
  normalizeKey,
} from '@/lib/contacts/dedupe';
import {
  parseContactCsv,
  parseCustomColumns,
  type CsvExtraColumn,
  type ParsedContactRow,
} from '@/lib/contacts/parse-contact-csv';
import {
  autoMapColumns,
  planRowCustomValues,
  type ColumnMapping,
  type CustomValueRow,
} from '@/lib/contacts/import-custom-fields';
import type { FieldDef, FieldType } from '@/lib/custom-fields/types';
import type { CustomField } from '@/types';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  assignImportedContactTags,
  resolveImportTagIds,
  type ContactTagAssignment,
} from '@/lib/contacts/resolve-import-tags';
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
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Tag,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

/** A parsed row plus its raw cells for the non-standard (custom field) columns. */
type ImportRow = ParsedContactRow & { custom?: Record<number, string> };

const DEFAULT_TAG_COLOR = '#3b82f6';
const CREATABLE_TYPES: FieldType[] = ['text', 'number', 'bool', 'date'];
const PREVIEW_LIMIT = 5;

function truncateFilename(name: string, max = 48): string {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, name.length - ext.length);
  const keep = max - ext.length - 1;
  return `${base.slice(0, Math.max(keep, 12))}…${ext}`;
}

function PreviewCell({
  value,
  mono,
  maxWidth = 'max-w-[9rem]',
}: {
  value: string;
  mono?: boolean;
  maxWidth?: string;
}) {
  return (
    <span
      className={cn(
        'block truncate',
        maxWidth,
        mono && 'font-mono text-[11px]'
      )}
      title={value}
    >
      {value}
    </span>
  );
}

function ImportPreviewTags({
  tagNames,
  tagColorByKey,
}: {
  tagNames: string[];
  tagColorByKey: Map<string, string>;
}) {
  const t = useTranslations('Contacts.importModal');

  if (tagNames.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div className="flex min-w-[4.5rem] flex-wrap gap-1">
      {tagNames.map((name) => {
        const color =
          tagColorByKey.get(name.trim().toLowerCase()) ?? DEFAULT_TAG_COLOR;
        const isKnown = tagColorByKey.has(name.trim().toLowerCase());
        return (
          <span
            key={name}
            className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] leading-none font-medium"
            style={{
              backgroundColor: `${color}18`,
              color,
              border: `1px solid ${color}${isKnown ? '55' : '30'}`,
            }}
            title={isKnown ? name : t('willBeCreated', { name })}
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="truncate">{name}</span>
          </span>
        );
      })}
    </div>
  );
}

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function ImportModal({
  open,
  onOpenChange,
  onImported,
}: ImportModalProps) {
  const t = useTranslations('Contacts.importModal');
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ImportRow[]>([]);
  const [extraColumns, setExtraColumns] = useState<CsvExtraColumn[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [fieldDefs, setFieldDefs] = useState<CustomField[]>([]);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [hasTagsColumn, setHasTagsColumn] = useState(false);
  const [hasCompanyColumn, setHasCompanyColumn] = useState(false);
  const [tagColorByKey, setTagColorByKey] = useState<Map<string, string>>(
    new Map()
  );
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    invalidPhone: number;
    failed: number;
    failedDetails: { phone: string; name?: string; reason: string }[];
    tagsAssigned: number;
    updated: number;
    customErrors: { phone: string; field: string; reason: string }[];
  } | null>(null);

  function reset() {
    setFile(null);
    setParsedRows([]);
    setExtraColumns([]);
    setMapping({});
    setUpdateExisting(false);
    setHasTagsColumn(false);
    setHasCompanyColumn(false);
    setTagColorByKey(new Map());
    setResult(null);
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

    const text = await selected.text();
    const {
      rows,
      hasTagsColumn: csvHasTags,
      hasCompanyColumn: csvHasCompany,
    } = parseContactCsv(text);

    if (rows.length === 0) {
      toast.error(t('toastNoValidRows'));
      setParsedRows([]);
      setExtraColumns([]);
      setMapping({});
      setHasTagsColumn(false);
      setHasCompanyColumn(false);
      setTagColorByKey(new Map());
      return;
    }

    const extra = parseCustomColumns(text);
    setParsedRows(rows.map((r, i) => ({ ...r, custom: extra.values[i] })));
    setExtraColumns(extra.columns);
    setHasTagsColumn(csvHasTags);
    setHasCompanyColumn(csvHasCompany);

    if (extra.columns.length > 0) {
      const res = await fetch('/api/custom-fields', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      const defs = ((data.fields as CustomField[] | undefined) ?? []).filter(
        (f) => f.field_type !== 'reference' && f.field_type !== 'media'
      );
      setFieldDefs(defs);
      setMapping(
        autoMapColumns(
          extra.columns,
          defs.map((f) => ({ id: f.id, key: f.key ?? f.id, field_name: f.field_name })),
          (index) => extra.values.slice(0, 50).map((v) => v[index] ?? ''),
          canEditSettings
        )
      );
    } else {
      setMapping({});
    }

    if (csvHasTags && accountId) {
      const { data: tags } = await supabase
        .from('tags')
        .select('name, color')
        .eq('account_id', accountId);

      const colors = new Map<string, string>();
      for (const tag of tags ?? []) {
        const key = tag.name.trim().toLowerCase();
        if (!colors.has(key)) colors.set(key, tag.color);
      }
      setTagColorByKey(colors);
    } else {
      setTagColorByKey(new Map());
    }
  }

  async function handleImport() {
    if (parsedRows.length === 0) return;
    setImporting(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error(t('notAuthenticated'));
      if (!accountId)
        throw new Error(t('notLinkedToAccount'));

      let imported = 0;
      let skipped = 0;
      let failed = 0;
      const failedDetails: { phone: string; name?: string; reason: string }[] =
        [];

      // 1) De-dupe within the file by normalized phone (keep first).
      //    Rows with no usable phone at all are counted separately -
      //    they never duplicated anything, so lumping them into
      //    `skipped` would misreport them as dupes (see dedupeByPhone).
      const {
        unique,
        duplicates: inFileDupes,
        invalid: invalidPhone,
      } = dedupeByPhone(parsedRows);
      skipped += inFileDupes;

      // 2) Skip numbers already in this account. One read of the
      //    generated `phone_normalized` column (migration 022) → Set.
      const { data: existingRows } = await supabase
        .from('contacts')
        .select('id, phone_normalized')
        .eq('account_id', accountId);
      const existingIdByPhone = new Map<string, string>();
      for (const r of (existingRows ?? []) as { id: string; phone_normalized: string | null }[]) {
        if (r.phone_normalized) existingIdByPhone.set(r.phone_normalized, r.id);
      }

      const toUpdate: { id: string; row: ImportRow }[] = [];
      const toInsert = unique.filter((row) => {
        const existingId = existingIdByPhone.get(normalizeKey(row.phone));
        if (existingId) {
          if (updateExisting) toUpdate.push({ id: existingId, row });
          else skipped++;
          return false;
        }
        return true;
      });

      // 2b) Custom field columns: create the fields the user asked for,
      //     then build typed value plans per row (bad cells are reported,
      //     the contact still imports).
      const effectiveMapping: ColumnMapping = { ...mapping };
      const createdDefs: CustomField[] = [];
      for (const col of extraColumns) {
        const target = effectiveMapping[col.index];
        if (target?.kind !== 'create') continue;
        const res = await fetch('/api/custom-fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: col.header, type: target.type }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.field) {
          createdDefs.push(data.field as CustomField);
          effectiveMapping[col.index] = { kind: 'field', fieldId: (data.field as CustomField).id };
        } else {
          effectiveMapping[col.index] = { kind: 'skip' };
          toast.warning(t('toastFieldNotCreated', { name: col.header, reason: data.error ?? '' }));
        }
      }
      const fieldsById = new Map<string, FieldDef>(
        [...fieldDefs, ...createdDefs].map((f) => [
          f.id,
          {
            id: f.id,
            key: f.key ?? f.id,
            field_name: f.field_name,
            field_type: f.field_type as FieldType,
            field_options: f.field_options as FieldDef['field_options'],
            required: false,
          },
        ])
      );
      const customErrors: { phone: string; field: string; reason: string }[] = [];
      const valueRows: (CustomValueRow & { contact_id: string })[] = [];
      const planFor = (row: ImportRow, contactId: string) => {
        const plan = planRowCustomValues(row.custom, effectiveMapping, fieldsById);
        for (const e of plan.errors) customErrors.push({ phone: row.phone, ...e });
        for (const u of plan.upserts) valueRows.push({ contact_id: contactId, ...u });
      };
      let updated = 0;

      // 3) Resolve tag names → ids (admin+ may auto-create missing tags).
      //    Skip the round-trip when the import carries no tag names.
      const allTagNames = toInsert.flatMap((row) => row.tagNames);
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

      // 4) Batch insert the genuinely-new rows in chunks of 50. The DB
      //    unique index is the backstop: a 23505 (race, or a format
      //    that normalizes equal) counts as skipped, not failed.
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
        }));

        const { data, error } = await supabase
          .from('contacts')
          .insert(rows)
          .select('id');

        if (error) {
          // Retry individually so one bad/duplicate row doesn't sink
          // the whole chunk.
          for (let j = 0; j < rows.length; j++) {
            const row = rows[j];
            const source = chunk[j];
            const { data: singleData, error: singleErr } = await supabase
              .from('contacts')
              .insert(row)
              .select('id')
              .single();

            if (!singleErr && singleData) {
              imported++;
              planFor(source, singleData.id);
              if (source.tagNames.length > 0) {
                tagAssignments.push({
                  contactId: singleData.id,
                  tagNames: source.tagNames,
                });
              }
            } else if (isUniqueViolation(singleErr)) {
              skipped++;
            } else {
              failed++;
              // Keep the actual DB error instead of discarding it -
              // "N contacts failed" with no reason attached left no
              // way to tell an RLS/constraint failure from a fluke,
              // let alone which contact it was.
              console.error(
                '[contacts import] insert failed for',
                row.phone,
                singleErr
              );
              failedDetails.push({
                phone: row.phone,
                name: row.name ?? undefined,
                reason:
                  (singleErr as { message?: string } | null)?.message ||
                  t('unknownReason'),
              });
            }
          }
        } else {
          const inserted = data ?? [];
          imported += inserted.length;
          // inserted[j] ↔ chunk[j] only holds because a single INSERT
          // preserves RETURNING order. If this path is ever split into
          // parallel inserts, zip by phone or returned id instead.
          for (let j = 0; j < inserted.length; j++) {
            const source = chunk[j];
            if (source) planFor(source, inserted[j].id);
            if (!source || source.tagNames.length === 0) continue;
            tagAssignments.push({
              contactId: inserted[j].id,
              tagNames: source.tagNames,
            });
          }
        }
      }

      // 4b) Update existing contacts (opt-in): only fields the CSV actually
      //     provides are changed, blank cells never erase data.
      for (const { id, row } of toUpdate) {
        const patch: Record<string, string> = {};
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

      // 4c) Write all typed custom values in batches.
      if (valueRows.length > 0) {
        for (let i = 0; i < valueRows.length; i += 200) {
          const { error: valErr } = await supabase
            .from('contact_custom_values')
            .upsert(valueRows.slice(i, i + 200), { onConflict: 'contact_id,custom_field_id' });
          if (valErr) {
            toast.warning(t('toastCustomValuesWarning'));
            break;
          }
        }
      }

      // 5) Wire tags onto the contacts we just created. Failure here must
      //    not mask a successful contact import.
      let tagsAssigned = 0;
      try {
        tagsAssigned = await assignImportedContactTags(
          supabase,
          tagAssignments,
          tagIdByKey
        );
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
        customErrors,
      });
      if (imported > 0) {
        toast.success(t('toastImported', { count: imported }));
        onImported();
      }
      if (updated > 0) {
        toast.success(t('toastUpdated', { count: updated }));
        onImported();
      }
      if (tagsAssigned > 0) {
        toast.success(t('toastTagsAssigned', { count: tagsAssigned }));
      }
      if (skippedNames.length > 0) {
        const sample = skippedNames.slice(0, 3).join(', ');
        const more =
          skippedNames.length > 3 ? t('toastTagsSkippedMore', { count: skippedNames.length - 3 }) : '';
        toast.info(t('toastTagsSkipped', { sample, more }));
      }
      if (skipped > 0) {
        toast.info(t('toastSkipped', { count: skipped }));
      }
      if (invalidPhone > 0) {
        toast.warning(t('toastInvalidPhone', { count: invalidPhone }));
      }
      if (failed > 0) {
        toast.error(t('toastFailed', { count: failed }));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('toastError');
      toast.error(message);
    } finally {
      setImporting(false);
    }
  }

  const preview = parsedRows.slice(0, PREVIEW_LIMIT);
  // Tags: OR - show when the CSV declares a column or preview rows carry
  // values, so an all-empty tags column still renders for validation.
  const previewHasTags =
    hasTagsColumn || preview.some((row) => row.tagNames.length > 0);
  // Company: AND - hide unless the CSV declares it and preview has data,
  // avoiding an all-dash column that wastes horizontal space.
  const previewHasCompany =
    hasCompanyColumn && preview.some((row) => row.company?.trim());

  const tagStats = useMemo(() => {
    const names = new Set<string>();
    let rowsWithTags = 0;
    for (const row of parsedRows) {
      if (row.tagNames.length === 0) continue;
      rowsWithTags++;
      for (const name of row.tagNames) names.add(name.trim().toLowerCase());
    }
    return { unique: names.size, rowsWithTags };
  }, [parsedRows]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-hidden border-border/80 bg-popover p-0 text-popover-foreground sm:max-w-2xl">
        <div className="shrink-0 space-y-4 border-b border-border/80 px-6 pt-6 pb-5">
          <DialogHeader className="gap-1.5">
            <DialogTitle className="text-lg text-popover-foreground">
              {t('title')}
            </DialogTitle>
            <DialogDescription className="leading-relaxed text-muted-foreground"
              dangerouslySetInnerHTML={{
                __html: t.markup('desc', {
                  phoneCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  nameCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  emailCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  companyCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  tagsCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                })
              }}
            />
          </DialogHeader>

          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ')
                fileInputRef.current?.click();
            }}
            className={cn(
              'group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-5 transition-all',
              file
                ? 'border-primary/35 bg-primary/[0.04]'
                : 'hover:border-primary/40 border-border/80 bg-background/40 hover:bg-background/70'
            )}
          >
            {file ? (
              <>
                <div className="bg-primary/15 ring-primary/25 flex size-10 items-center justify-center rounded-lg ring-1">
                  <FileText className="text-primary size-5" />
                </div>
                <p
                  className="max-w-full truncate px-2 text-sm font-medium text-popover-foreground"
                  title={file.name}
                >
                  {truncateFilename(file.name)}
                </p>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {t('rowsReady', { count: parsedRows.length })}
                </span>
              </>
            ) : (
              <>
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted/80 ring-1 ring-border/80 transition-colors group-hover:bg-muted">
                  <Upload className="size-5 text-muted-foreground group-hover:text-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('uploadDropzone')}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t('uploadHint')}
                </p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {preview.length > 0 && !result && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  {t('preview', { count: preview.length })}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {tagStats.rowsWithTags > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/90 px-2 py-0.5 text-[11px] text-muted-foreground">
                      <Tag className="text-primary/80 size-3" />
                      {t('previewTags', { tags: tagStats.unique, contacts: tagStats.rowsWithTags })}
                    </span>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-border ring-1 ring-border/50">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[32rem] text-xs">
                    <thead>
                      <tr className="border-b border-border bg-background/60">
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.phone')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.name')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.email')}
                        </th>
                        {previewHasCompany && (
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            {t('columns.company')}
                          </th>
                        )}
                        {previewHasTags && (
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            {t('columns.tags')}
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {preview.map((row, i) => (
                        <tr
                          key={i}
                          className="bg-popover/40 transition-colors hover:bg-muted/30"
                        >
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                            <PreviewCell
                              value={row.phone}
                              mono
                              maxWidth="max-w-[7.5rem]"
                            />
                          </td>
                          <td className="px-3 py-2 text-popover-foreground">
                            <PreviewCell
                              value={row.name || '-'}
                              maxWidth="max-w-[8.5rem]"
                            />
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            <PreviewCell
                              value={row.email || '-'}
                              maxWidth="max-w-[10rem]"
                            />
                          </td>
                          {previewHasCompany && (
                            <td className="px-3 py-2 text-muted-foreground">
                              <PreviewCell
                                value={row.company || '-'}
                                maxWidth="max-w-[7rem]"
                              />
                            </td>
                          )}
                          {previewHasTags && (
                            <td className="px-3 py-2 align-top">
                              <ImportPreviewTags
                                tagNames={row.tagNames}
                                tagColorByKey={tagColorByKey}
                              />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {parsedRows.length > PREVIEW_LIMIT && (
                <p className="text-center text-[11px] text-muted-foreground">
                  {t('moreRows', { count: parsedRows.length - PREVIEW_LIMIT })}
                </p>
              )}
            </div>
          )}

          {extraColumns.length > 0 && !result && (
            <div className="mt-5 space-y-3">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                {t('mapping.title')}
              </p>
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-border/70">
                    {extraColumns.map((col) => {
                      const target = mapping[col.index] ?? { kind: 'skip' as const };
                      const sample = parsedRows.find((r) => r.custom?.[col.index])?.custom?.[col.index] ?? '';
                      const value =
                        target.kind === 'field'
                          ? `f:${target.fieldId}`
                          : target.kind === 'create'
                            ? `c:${target.type}`
                            : 'skip';
                      const label =
                        target.kind === 'field'
                          ? (fieldDefs.find((f) => f.id === target.fieldId)?.field_name ?? '')
                          : target.kind === 'create'
                            ? t('mapping.createLabel', { type: t(`mapping.types.${target.type}`) })
                            : t('mapping.skip');
                      return (
                        <tr key={col.index}>
                          <td className="w-1/3 px-3 py-2">
                            <PreviewCell value={col.header} maxWidth="max-w-[9rem]" />
                          </td>
                          <td className="w-1/4 px-3 py-2 text-muted-foreground">
                            <PreviewCell value={sample || '-'} maxWidth="max-w-[8rem]" />
                          </td>
                          <td className="px-3 py-2">
                            <Select
                              value={value}
                              onValueChange={(v) => {
                                if (!v) return;
                                setMapping((prev) => ({
                                  ...prev,
                                  [col.index]:
                                    v === 'skip'
                                      ? { kind: 'skip' }
                                      : v.startsWith('f:')
                                        ? { kind: 'field', fieldId: v.slice(2) }
                                        : { kind: 'create', type: v.slice(2) as FieldType },
                                }));
                              }}
                            >
                              <SelectTrigger className="h-8 w-full text-xs">
                                <SelectValue>{label}</SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="skip">{t('mapping.skip')}</SelectItem>
                                {fieldDefs.map((f) => (
                                  <SelectItem key={f.id} value={`f:${f.id}`}>
                                    {f.field_name}
                                  </SelectItem>
                                ))}
                                {canEditSettings &&
                                  CREATABLE_TYPES.map((ty) => (
                                    <SelectItem key={ty} value={`c:${ty}`}>
                                      {t('mapping.createLabel', { type: t(`mapping.types.${ty}`) })}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">{t('mapping.hint')}</p>
            </div>
          )}

          {parsedRows.length > 0 && !result && (
            <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-popover-foreground">
              <Checkbox checked={updateExisting} onCheckedChange={(c) => setUpdateExisting(c === true)} className="mt-0.5" />
              <span>
                {t('updateExisting')}
                <span className="block text-[11px] text-muted-foreground">{t('updateExistingHint')}</span>
              </span>
            </label>
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
                    <p className="pl-[1.375rem] text-xs text-muted-foreground">
                      {t('invalidPhoneHint')}
                    </p>
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
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    {t('failedRowsHeading')}
                  </p>
                  <ul className="max-h-32 space-y-1 overflow-y-auto text-xs">
                    {result.failedDetails.map((row, i) => (
                      <li
                        key={i}
                        className="flex items-baseline gap-2 text-muted-foreground"
                      >
                        <span className="shrink-0 font-mono text-popover-foreground">
                          {row.name ? `${row.name} (${row.phone})` : row.phone}
                        </span>
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
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {result ? t('close') : t('cancel')}
          </Button>
          {!result && (
            <Button
              type="button"
              disabled={parsedRows.length === 0 || importing}
              onClick={handleImport}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              {parsedRows.length > 0 ? t('importBtn', { count: parsedRows.length }) : t('importBtn', { count: 0 })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
