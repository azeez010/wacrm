'use client';

import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { BulkOutcome, BulkProgress } from '@/lib/contacts/bulk';

/** Thin progress bar for a running bulk action. */
export function BulkProgressBar({ progress }: { progress: BulkProgress | null }) {
  const t = useTranslations('Contacts.page.bulk');
  if (!progress) return null;
  const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
  return (
    <div className="space-y-1.5" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{t('progress', { done: progress.done, total: progress.total })}</p>
    </div>
  );
}

/** Result summary: how many worked, were skipped, or failed (with reasons). */
export function BulkResultBlock({
  outcome,
  okLabel,
  skippedLabel,
  nameById,
}: {
  outcome: BulkOutcome;
  okLabel: string;
  skippedLabel?: string;
  nameById?: Record<string, string>;
}) {
  const t = useTranslations('Contacts.page.bulk');
  return (
    <div className="space-y-2 rounded-lg border border-border bg-background/50 p-3 text-sm">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {outcome.ok > 0 && (
          <span className="flex items-center gap-1.5 text-primary">
            <CheckCircle className="size-4" />
            {okLabel}
          </span>
        )}
        {outcome.skipped > 0 && skippedLabel && (
          <span className="flex items-center gap-1.5 text-amber-400">
            <AlertTriangle className="size-4" />
            {skippedLabel}
          </span>
        )}
        {outcome.failed > 0 && (
          <span className="flex items-center gap-1.5 text-red-400">
            <XCircle className="size-4" />
            {t('failedCount', { count: outcome.failed })}
          </span>
        )}
      </div>
      {outcome.errors.length > 0 && (
        <ul className="max-h-28 space-y-1 overflow-y-auto border-t border-border pt-2 text-xs text-muted-foreground">
          {outcome.errors.map((e, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 text-foreground">{nameById?.[e.id] ?? e.id.slice(0, 8)}</span>
              <span className="truncate">{e.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
