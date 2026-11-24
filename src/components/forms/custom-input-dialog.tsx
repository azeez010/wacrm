'use client';

// "Custom input": pick what kind of answer you want to collect, then either map
// it to a contact field you already have of that type, or create a new custom
// field on the spot. Either way the form gets a normal custom_field input.

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';
import type { FormField } from '@/lib/forms/types';
import type { FormEditorData } from './use-form-data';

const INPUT_TYPES = ['text', 'number', 'bool', 'date', 'datetime', 'enum', 'multi_enum', 'url', 'phone', 'email'] as const;
type InputType = (typeof INPUT_TYPES)[number];

export function CustomInputDialog({
  open,
  onOpenChange,
  data,
  used,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: FormEditorData;
  /** Custom field ids already on the form. */
  used: Set<string>;
  onAdd: (field: FormField) => void;
}) {
  const t = useTranslations('Forms.edit');
  const canCreate = useCan('edit-settings');
  const [type, setType] = useState<InputType>('text');
  const [name, setName] = useState('');
  const [optionsText, setOptionsText] = useState('');
  const [busy, setBusy] = useState(false);

  const isChoice = type === 'enum' || type === 'multi_enum';
  const options = optionsText
    .split('\n')
    .map((o) => o.trim())
    .filter(Boolean);
  const existing = data.customFields.filter((c) => c.field_type === type && !used.has(c.id));
  const canSubmit = canCreate && !busy && name.trim().length > 0 && (!isChoice || options.length > 0);

  const close = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
    if (!next) {
      setName('');
      setOptionsText('');
      setType('text');
    }
  };

  async function create() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const res = await fetch('/api/custom-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, ...(isChoice ? { options: { options } } : {}) }),
      });
      const json = (await res.json().catch(() => ({}))) as { field?: { id: string; key: string; field_name: string }; error?: string };
      if (!res.ok || !json.field) {
        toast.error(json.error || t('customCreateFailed'));
        return;
      }
      data.reload();
      onAdd({ id: `cf_${json.field.key}`, kind: 'custom_field', customFieldId: json.field.id, label: json.field.field_name });
      onOpenChange(false);
      setName('');
      setOptionsText('');
      setType('text');
    } catch {
      toast.error(t('customCreateFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('customInputTitle')}</DialogTitle>
          <DialogDescription>{t('customInputDesc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('inputTypeLabel')}</Label>
            <div role="radiogroup" aria-label={t('inputTypeLabel')} className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {INPUT_TYPES.map((it) => (
                <button
                  key={it}
                  type="button"
                  role="radio"
                  aria-checked={type === it}
                  onClick={() => setType(it)}
                  className={cn('rounded-lg border px-2.5 py-2 text-left text-sm transition-colors', type === it ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted')}
                >
                  {t(`inputType.${it}`)}
                </button>
              ))}
            </div>
          </div>

          {existing.length > 0 ? (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t('useExisting')}</Label>
              <ul className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
                {existing.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onAdd({ id: `cf_${c.key}`, kind: 'custom_field', customFieldId: c.id, label: c.field_name });
                        close(false);
                      }}
                      className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      {c.field_name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
            <Label className="text-xs text-muted-foreground">{existing.length > 0 ? t('orCreateNew') : t('createNew')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('newFieldNamePlaceholder')} disabled={!canCreate || busy} className="h-9" />
            {isChoice ? <Textarea rows={3} value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder={t('optionsPlaceholder')} disabled={!canCreate || busy} /> : null}
            {!canCreate ? <p className="text-xs text-amber-600">{t('adminOnlyCreate')}</p> : <p className="text-xs text-muted-foreground">{t('createHint')}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void create()} disabled={!canSubmit}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('createAndAdd')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
