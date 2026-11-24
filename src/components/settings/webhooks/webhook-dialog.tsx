'use client';

// Add / edit a webhook: just a URL and the events it should receive.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WEBHOOK_EVENTS } from '@/lib/webhooks/events';
import { EVENT_DESC_KEY, EVENT_LABEL_KEY, type Webhook } from './types';

export function WebhookDialog({
  editing,
  onClose,
  onSaved,
  onCreated,
}: {
  editing: Webhook | null;
  onClose: () => void;
  onSaved: (w: Webhook) => void;
  onCreated: (w: Webhook, secret: string) => void;
}) {
  const t = useTranslations('Settings.webhooks');
  const [url, setUrl] = useState(editing?.url ?? '');
  const [events, setEvents] = useState<string[]>(editing?.events ?? [...WEBHOOK_EVENTS]);
  const [saving, setSaving] = useState(false);

  const toggle = (ev: string, on: boolean) =>
    setEvents((p) => (on ? [...p, ev] : p.filter((e) => e !== ev)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(
        editing ? `/api/account/webhooks/${editing.id}` : '/api/account/webhooks',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim(), events }),
        }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('saveFailed'));
        return;
      }
      if (editing) {
        toast.success(t('updated'));
        onSaved(payload.webhook as Webhook);
      } else {
        onCreated(payload.webhook as Webhook, payload.secret as string);
      }
    } catch {
      toast.error(t('networkError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? t('editTitle') : t('addTitle')}</DialogTitle>
            <DialogDescription>{t('dialogDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="webhook-url">{t('urlLabel')}</Label>
            <Input
              id="webhook-url"
              type="url"
              inputMode="url"
              autoFocus
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/webhooks/ogadesk"
            />
            <p className="text-muted-foreground text-xs">{t('urlHint')}</p>
          </div>

          <div className="space-y-2">
            <Label>{t('eventsLabel')}</Label>
            <ul className="divide-border divide-y rounded-md border">
              {WEBHOOK_EVENTS.map((ev) => (
                <li key={ev}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                    <Checkbox
                      className="mt-0.5"
                      checked={events.includes(ev)}
                      onCheckedChange={(v) => toggle(ev, v === true)}
                    />
                    <span className="min-w-0">
                      <span className="text-foreground block text-sm font-medium">
                        {t(EVENT_LABEL_KEY[ev])}{' '}
                        <span className="text-muted-foreground font-mono text-[11px] font-normal">
                          {ev}
                        </span>
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {t(EVENT_DESC_KEY[ev])}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={saving || !url.trim() || events.length === 0}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {editing ? t('save') : t('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
