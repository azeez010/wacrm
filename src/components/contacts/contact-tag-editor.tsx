'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import { fetchTagUsage } from '@/lib/contacts/tag-usage';
import type { Tag } from '@/types';
import { RemoveTagDialog } from './remove-tag-dialog';

interface Props {
  contactId: string;
  contactName: string;
  /** Tags currently on the contact. */
  tags: Tag[];
  /** Every tag in the account (for the + list). */
  allTags: Tag[];
  canEdit: boolean;
  /** Table-cell mode: tighter chips, the x shows on hover, overflow collapses into +N. */
  compact?: boolean;
  onChange: (next: Tag[]) => void;
}

/**
 * Add (+) and remove (x) tags on one contact. Used in the contact detail
 * and in the Contacts table. Removing always asks first and shows what
 * depends on the tag. Add/remove go through the normal tag endpoint, so
 * "tag added" automations still fire.
 */
export function ContactTagEditor({ contactId, contactName, tags, allTags, canEdit, compact, onChange }: Props) {
  const t = useTranslations('Contacts.tagEditor');
  const [addOpen, setAddOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [busyTagId, setBusyTagId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Tag | null>(null);

  const appliedIds = useMemo(() => new Set(tags.map((tg) => tg.id)), [tags]);
  const available = useMemo(
    () =>
      allTags
        .filter((tg) => !appliedIds.has(tg.id))
        .filter((tg) => tg.name.toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allTags, appliedIds, search]
  );

  const maxVisible = compact ? 2 : tags.length;
  const visible = tags.slice(0, maxVisible);
  const hidden = tags.slice(maxVisible);

  async function add(tag: Tag) {
    setBusyTagId(tag.id);
    try {
      await addContactTag(contactId, tag.id);
      onChange([...tags, tag]);
      setAddOpen(false);
      setSearch('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('failed'));
    } finally {
      setBusyTagId(null);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusyTagId(removing.id);
    try {
      await deleteContactTag(contactId, removing.id);
      onChange(tags.filter((tg) => tg.id !== removing.id));
      toast.success(t('removed', { tag: removing.name }));
      setRemoving(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('failed'));
    } finally {
      setBusyTagId(null);
    }
  }

  const chip = (tag: Tag) => (
    <span
      key={tag.id}
      className={cn(
        'group/chip inline-flex max-w-full items-center gap-1 rounded-full font-medium',
        compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
      )}
      style={{ backgroundColor: tag.color + '20', color: tag.color }}
    >
      <span className="truncate">{tag.name}</span>
      {canEdit && (
        <button
          type="button"
          aria-label={t('removeAria', { tag: tag.name })}
          title={t('removeAria', { tag: tag.name })}
          disabled={busyTagId === tag.id}
          // Warm the "what uses this tag" answer so the confirmation opens ready.
          onMouseEnter={() => void fetchTagUsage(tag.id).catch(() => undefined)}
          onFocus={() => void fetchTagUsage(tag.id).catch(() => undefined)}
          onClick={(e) => {
            e.stopPropagation();
            setRemoving(tag);
          }}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100',
            compact && 'w-0 overflow-hidden opacity-0 group-hover/chip:w-3 group-hover/chip:opacity-70 focus-visible:w-3'
          )}
        >
          {busyTagId === tag.id ? <Loader2 className="size-3 animate-spin" /> : <X className={compact ? 'size-2.5' : 'size-3'} />}
        </button>
      )}
    </span>
  );

  return (
    <div
      className={cn('flex flex-wrap items-center', compact ? 'gap-1' : 'gap-1.5')}
      onClick={compact ? (e) => e.stopPropagation() : undefined}
    >
      {tags.length === 0 && !canEdit && <span className="text-xs text-muted-foreground">-</span>}
      {visible.map(chip)}

      {hidden.length > 0 && (
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger
            render={<button type="button" onClick={(e) => e.stopPropagation()} />}
            className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          >
            +{hidden.length}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto max-w-xs p-2">
            <div className="flex flex-wrap gap-1.5">{hidden.map(chip)}</div>
          </PopoverContent>
        </Popover>
      )}

      {canEdit && (
        <Popover open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setSearch(''); }}>
          <PopoverTrigger
            render={<button type="button" onClick={(e) => e.stopPropagation()} />}
            aria-label={t('add')}
            title={t('add')}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary',
              compact ? 'size-5 justify-center' : 'px-2.5 py-1 text-xs'
            )}
          >
            <Plus className={compact ? 'size-3' : 'size-3.5'} />
            {!compact && t('add')}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-0" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-border p-2">
              <Input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('search')}
                className="h-8 bg-muted text-sm"
              />
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {available.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {allTags.length === 0 ? t('noTags') : t('noMore')}
                </p>
              ) : (
                available.map((tg) => (
                  <button
                    key={tg.id}
                    type="button"
                    disabled={busyTagId === tg.id}
                    onClick={() => void add(tg)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-60"
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tg.color }} />
                    <span className="truncate">{tg.name}</span>
                    {busyTagId === tg.id && <Loader2 className="ml-auto size-3.5 animate-spin" />}
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {removing && (
        <RemoveTagDialog
          tag={removing}
          contactName={contactName}
          busy={busyTagId === removing.id}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void confirmRemove()}
        />
      )}
    </div>
  );
}
