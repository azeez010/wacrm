'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface RecordOption {
  id: string;
  label: string;
}

interface ReferencePickerProps {
  /** Key (or id) of the custom table to pick rows from. */
  tableKey: string;
  /** Selected record id, or '' for none. */
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Type-ahead picker over the rows of a custom table. Searches the server
 * (label match, paged) instead of loading every row, so it stays fast for
 * tables with thousands of rows. Also the Choice picker for filters.
 */
export function ReferencePicker({ tableKey, value, onChange, disabled, className }: ReferencePickerProps) {
  const t = useTranslations('CustomFields.picker');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<RecordOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('');
  const seq = useRef(0);

  // Resolve the label of the current value (it may not be in the first page).
  useEffect(() => {
    if (!value) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedLabel('');
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/custom-tables/${encodeURIComponent(tableKey)}/records?ids=${value}`);
      const data = await res.json().catch(() => ({}));
      const hit = (data.records as RecordOption[] | undefined)?.find((r) => r.id === value);
      if (!cancelled) setSelectedLabel(hit?.label ?? '');
    })();
    return () => {
      cancelled = true;
    };
  }, [tableKey, value]);

  // Debounced server search while the popover is open.
  useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const handle = setTimeout(async () => {
      const q = new URLSearchParams({ limit: '30' });
      if (search.trim()) q.set('search', search.trim());
      const res = await fetch(`/api/custom-tables/${encodeURIComponent(tableKey)}/records?${q}`);
      const data = await res.json().catch(() => ({}));
      if (mine !== seq.current) return;
      setOptions(((data.records as RecordOption[] | undefined) ?? []).map((r) => ({ id: r.id, label: r.label })));
      setLoading(false);
    }, 200);
    return () => clearTimeout(handle);
  }, [open, search, tableKey]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="outline"
            className={cn(
              'h-8 w-full justify-between border-border bg-muted px-2 text-sm font-normal text-foreground',
              !selectedLabel && 'text-muted-foreground',
              className
            )}
          />
        }
      >
        <span className="truncate">{selectedLabel || t('placeholder')}</span>
        <span className="flex items-center gap-1">
          {value && !disabled && (
            <X
              className="size-3.5 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
            />
          )}
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
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
          {loading && options.length === 0 ? (
            <div className="flex justify-center py-4">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : options.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">{t('empty')}</p>
          ) : (
            options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onChange(o.id);
                  setSelectedLabel(o.label);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
              >
                <Check className={cn('size-3.5 shrink-0', o.id === value ? 'opacity-100' : 'opacity-0')} />
                <span className="truncate">{o.label || t('unnamed')}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
