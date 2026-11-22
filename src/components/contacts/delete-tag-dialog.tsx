'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fetchTagUsage, peekTagUsage, type TagUsage } from '@/lib/contacts/tag-usage';
import type { Tag } from '@/types';
import { TagUsagePanel } from './remove-tag-dialog';

interface Props {
  tag: Tag;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Deleting a tag removes it from every contact. This spells that out first:
 * how many contacts carry it and which segments, automations, flows and open
 * broadcasts use it.
 */
export function DeleteTagDialog({ tag, busy, onCancel, onConfirm }: Props) {
  const t = useTranslations('Contacts.tagEditor.delete');
  const tr = useTranslations('Contacts.tagEditor.remove');
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

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title', { tag: tag.name })}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>

        <TagUsagePanel usage={usage} failed={failed}>
          {usage && (
            <p className="rounded-lg bg-muted px-3 py-2 text-foreground">
              {t('onContacts', { count: usage.contactCount ?? 0 })}
            </p>
          )}
        </TagUsagePanel>
        <p className="text-xs text-muted-foreground">{t('safe')}</p>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {tr('cancel')}
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
