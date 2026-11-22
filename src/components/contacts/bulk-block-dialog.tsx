'use client';

import { useState } from 'react';
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
import { blockContact, unblockContact } from '@/lib/contacts/block-api';
import { runBulk, type BulkOutcome, type BulkProgress } from '@/lib/contacts/bulk';
import { BulkProgressBar, BulkResultBlock } from './bulk-result';

interface Props {
  mode: 'block' | 'unblock';
  contacts: { id: string; name?: string | null; phone: string }[];
  onClose: () => void;
  /** Called after a run finished (so the page can refresh while keeping the selection). */
  onDone: () => void;
}

/**
 * Block or unblock every selected contact. Mirrors the tag dialog: one
 * request per contact, already-in-state contacts are counted as skipped.
 * Blocking spells out what it stops, since it is hard to notice later.
 */
export function BulkBlockDialog({ mode, contacts, onClose, onDone }: Props) {
  const t = useTranslations('Contacts.page.bulk');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);
  const nameById = Object.fromEntries(contacts.map((c) => [c.id, c.name || c.phone]));
  const blocking = mode === 'block';

  async function run() {
    setRunning(true);
    setProgress({ done: 0, total: contacts.length });
    const result = await runBulk(
      contacts,
      5,
      async (c) => {
        const r = blocking ? await blockContact(c.id) : await unblockContact(c.id);
        return r.changed ? 'ok' : 'skipped';
      },
      setProgress,
    );
    setOutcome(result);
    setRunning(false);
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{blocking ? t('blockTitle') : t('unblockTitle')}</DialogTitle>
          <DialogDescription>{t('forContacts', { count: contacts.length })}</DialogDescription>
        </DialogHeader>

        {!outcome && (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>{blocking ? t('blockConsequences') : t('unblockConsequences')}</p>
            <BulkProgressBar progress={running ? progress : null} />
          </div>
        )}

        {outcome && (
          <BulkResultBlock
            outcome={outcome}
            okLabel={blocking ? t('blockedCount', { count: outcome.ok }) : t('unblockedCount', { count: outcome.ok })}
            skippedLabel={blocking ? t('alreadyBlockedCount', { count: outcome.skipped }) : t('notBlockedCount', { count: outcome.skipped })}
            nameById={nameById}
          />
        )}

        <DialogFooter>
          {outcome ? (
            <Button onClick={onClose}>{t('close')}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={running}>
                {t('cancel')}
              </Button>
              <Button variant={blocking ? 'destructive' : 'default'} onClick={run} disabled={running}>
                {running && <Loader2 className="size-4 animate-spin" />}
                {blocking ? t('blockRun', { count: contacts.length }) : t('unblockRun', { count: contacts.length })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
