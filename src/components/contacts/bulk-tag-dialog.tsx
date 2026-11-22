'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import { runBulk, type BulkOutcome, type BulkProgress } from '@/lib/contacts/bulk';
import type { Tag } from '@/types';
import { BulkProgressBar, BulkResultBlock } from './bulk-result';

interface Props {
  mode: 'add' | 'remove';
  contacts: { id: string; name?: string | null; phone: string }[];
  tags: Tag[];
  onClose: () => void;
  /** Called after a run finished (so the page can refresh while keeping the selection). */
  onDone: () => void;
}

/**
 * Add or remove one tag on every selected contact. Goes through the same
 * per-contact endpoint as the detail view, so "tag added" automations fire
 * exactly as they would for a single contact.
 */
export function BulkTagDialog({ mode, contacts, tags, onClose, onDone }: Props) {
  const t = useTranslations('Contacts.page.bulk');
  const [tagId, setTagId] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);

  const sorted = [...tags].sort((a, b) => a.name.localeCompare(b.name));
  const nameById = Object.fromEntries(contacts.map((c) => [c.id, c.name || c.phone]));

  async function run() {
    if (!tagId) return;
    setRunning(true);
    setProgress({ done: 0, total: contacts.length });
    const result = await runBulk(
      contacts,
      5,
      async (c) => {
        if (mode === 'add') {
          const r = await addContactTag(c.id, tagId);
          return r.added === false ? 'skipped' : 'ok';
        }
        await deleteContactTag(c.id, tagId);
        return 'ok';
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
          <DialogTitle>{mode === 'add' ? t('addTagTitle') : t('removeTagTitle')}</DialogTitle>
          <DialogDescription>{t('forContacts', { count: contacts.length })}</DialogDescription>
        </DialogHeader>

        {!outcome && (
          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground">{t('pickTag')}</Label>
            {sorted.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noTags')}</p>
            ) : (
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {sorted.map((tag) => {
                  const on = tagId === tag.id;
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      disabled={running}
                      aria-pressed={on}
                      onClick={() => setTagId(tag.id)}
                      className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-all disabled:opacity-60"
                      style={{
                        backgroundColor: on ? tag.color + '30' : undefined,
                        borderColor: on ? tag.color : undefined,
                        color: tag.color,
                      }}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            )}
            <BulkProgressBar progress={running ? progress : null} />
          </div>
        )}

        {outcome && (
          <BulkResultBlock
            outcome={outcome}
            okLabel={mode === 'add' ? t('taggedCount', { count: outcome.ok }) : t('untaggedCount', { count: outcome.ok })}
            skippedLabel={t('alreadyHadCount', { count: outcome.skipped })}
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
              <Button onClick={run} disabled={!tagId || running}>
                {running && <Loader2 className="size-4 animate-spin" />}
                {mode === 'add' ? t('addTagRun', { count: contacts.length }) : t('removeTagRun', { count: contacts.length })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
