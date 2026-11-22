'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { API_SCOPES, SCOPE_DESCRIPTIONS, type ApiScope } from '@/lib/api-keys/scopes';
import { PRESET_SCOPES, presetFor, type PresetId } from '@/lib/api-keys/presets';
import type { ApiKey } from './types';

const selectCls = 'h-9 w-full rounded-lg border border-border bg-muted px-2 text-sm text-foreground';

type Access = PresetId | 'custom';

/** Create a key, or edit an existing key's name and access. */
export function KeyDialog({
  open,
  editing,
  onClose,
  onCreated,
  onSaved,
}: {
  open: boolean;
  /** The key being edited; null to create one. */
  editing: ApiKey | null;
  onClose: () => void;
  onCreated: (key: ApiKey, plaintext: string) => void;
  onSaved: (key: ApiKey) => void;
}) {
  // The parent remounts this (key prop) whenever it opens, so initial state is always fresh.
  const t = useTranslations('Settings.apiKeys');
  const [name, setName] = useState(editing?.name ?? '');
  const [access, setAccess] = useState<Access>(editing ? presetFor(editing.scopes) : 'read');
  const [custom, setCustom] = useState<ApiScope[]>(editing ? (editing.scopes as ApiScope[]) : []);
  const [busy, setBusy] = useState(false);

  const scopes = access === 'custom' ? custom : PRESET_SCOPES[access];

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t('nameRequired'));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(editing ? `/api/account/api-keys/${editing.id}` : '/api/account/api-keys', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, scopes }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t(editing ? 'updateFailed' : 'createError'));
        return;
      }
      if (editing) {
        onSaved({ ...editing, ...(payload.key as ApiKey) });
        toast.success(t('saved'));
      } else {
        onCreated({ ...(payload.key as ApiKey), has_secret: true }, payload.plaintext as string);
      }
    } catch {
      toast.error(t('networkError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="border-border bg-popover max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t('editTitle') : t('newTitle')}</DialogTitle>
          <DialogDescription>{t('newDesc')}</DialogDescription>
        </DialogHeader>

        <div className="-m-1 space-y-4 overflow-y-auto p-1">
          <div className="space-y-1.5">
            <Label htmlFor="api-key-name" className="text-muted-foreground">{t('nameLabel')}</Label>
            <Input id="api-key-name" value={name} maxLength={80} placeholder={t('namePlaceholder')} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="api-key-access" className="text-muted-foreground">{t('accessLabel')}</Label>
            <select id="api-key-access" className={selectCls} value={access} onChange={(e) => setAccess(e.target.value as Access)}>
              <option value="read">{t('accessRead')}</option>
              <option value="builder">{t('accessBuilder')}</option>
              <option value="full">{t('accessFull')}</option>
              <option value="custom">{t('accessCustomOption')}</option>
            </select>
            <p className="text-muted-foreground text-xs">{t(`hint.${access}`)}</p>
          </div>

          {access === 'custom' ? (
            <div className="border-border space-y-2 rounded-md border p-3">
              {API_SCOPES.map((scope) => (
                <label key={scope} className="flex cursor-pointer items-start gap-2.5">
                  <Checkbox
                    checked={custom.includes(scope)}
                    onCheckedChange={(c) => setCustom((prev) => (c === true ? [...prev, scope] : prev.filter((s) => s !== scope)))}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="text-foreground block font-mono text-xs">{scope}</span>
                    <span className="text-muted-foreground block text-xs">{SCOPE_DESCRIPTIONS[scope]}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {editing ? t('save') : t('createKey')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
