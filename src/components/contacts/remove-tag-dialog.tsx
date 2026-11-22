'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fetchTagUsage, peekTagUsage, type NamedRef, type TagUsage } from '@/lib/contacts/tag-usage';
import type { Tag } from '@/types';

interface Props {
  tag: Tag;
  contactName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function NameList({ items }: { items: NamedRef[] }) {
  const t = useTranslations('Contacts.tagEditor.remove');
  const shown = items.slice(0, 3).map((i) => i.name);
  const rest = items.length - shown.length;
  return (
    <span className="text-muted-foreground">
      {shown.join(', ')}
      {rest > 0 ? ` ${t('andMore', { count: rest })}` : ''}
    </span>
  );
}

/**
 * Asks before a tag is taken off a contact and spells out what depends on
 * that tag (segments, active automations and flows, open broadcasts). The
 * numbers are loaded live; usually they are already cached from the hover.
 */
export function RemoveTagDialog({ tag, contactName, busy, onCancel, onConfirm }: Props) {
  const t = useTranslations('Contacts.tagEditor.remove');
  const [usage, setUsage] = useState<TagUsage | null>(() => peekTagUsage(tag.id));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchTagUsage(tag.id)
      .then((u) => {
        if (!cancelled) setUsage(u);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tag.id]);

  const rows: { key: string; label: string; items: NamedRef[] }[] = usage
    ? [
        { key: 'segments', label: t('segments', { count: usage.segments.length }), items: usage.segments },
        { key: 'automations', label: t('automations', { count: usage.automations.length }), items: usage.automations },
        { key: 'flows', label: t('flows', { count: usage.flows.length }), items: usage.flows },
        { key: 'broadcasts', label: t('broadcasts', { count: usage.broadcasts.length }), items: usage.broadcasts },
      ].filter((r) => r.items.length > 0)
    : [];

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title', { tag: tag.name, contact: contactName })}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          {!usage && !failed && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('checking')}
            </p>
          )}
          {failed && <p className="text-muted-foreground">{t('checkFailed')}</p>}
          {usage && rows.length === 0 && <p className="text-muted-foreground">{t('nothingUses')}</p>}
          {rows.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
                <AlertTriangle className="size-3.5" />
                {t('usedBy')}
              </p>
              <ul className="space-y-1.5">
                {rows.map((r) => (
                  <li key={r.key}>
                    <span className="text-foreground">{r.label}</span> <NameList items={r.items} />
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{t('effect', { contact: contactName })}</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('safe')}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
