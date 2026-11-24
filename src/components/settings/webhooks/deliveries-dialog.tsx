'use client';

// Recent delivery attempts for one endpoint, with a failed-only filter
// and a "resend" for any attempt that stored its payload.

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Loader2, RotateCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Delivery, Webhook } from './types';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function DeliveriesDialog({
  webhook,
  onClose,
  onChanged,
}: {
  webhook: Webhook;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('Settings.webhooks');
  const [rows, setRows] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [failedOnly, setFailedOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/account/webhooks/${webhook.id}/deliveries${failedOnly ? '?failed=1' : ''}`,
        { cache: 'no-store' }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('loadFailed'));
        return;
      }
      setRows(payload.deliveries as Delivery[]);
    } catch {
      toast.error(t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [webhook.id, failedOnly, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resend(d: Delivery) {
    setResending(d.id);
    try {
      const res = await fetch(
        `/api/account/webhooks/${webhook.id}/deliveries/${d.id}/resend`,
        { method: 'POST' }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('resendFailed'));
        return;
      }
      if (payload.ok) toast.success(t('resent'));
      else toast.error(t('resentFailedResponse', { reason: payload.error ?? '' }));
      await load();
      onChanged();
    } catch {
      toast.error(t('networkError'));
    } finally {
      setResending(null);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('deliveriesTitle')}</DialogTitle>
          <DialogDescription className="break-all">{webhook.url}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">{t('deliveriesRetention', { days: 14 })}</p>
          <Button
            size="sm"
            variant={failedOnly ? 'default' : 'outline'}
            onClick={() => setFailedOnly((v) => !v)}
          >
            {t('failedOnly')}
          </Button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto rounded-md border">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="text-primary size-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground py-10 text-center text-sm">
              {t('deliveriesEmpty')}
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {rows.map((d) => {
                const isOpen = open === d.id;
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : d.id)}
                      className="hover:bg-muted/50 flex w-full items-center gap-3 px-3 py-2.5 text-left"
                    >
                      {isOpen ? (
                        <ChevronDown className="text-muted-foreground size-4 shrink-0" />
                      ) : (
                        <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                      )}
                      <Badge
                        className={
                          d.ok
                            ? 'border-transparent bg-emerald-100 text-[10px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'border-transparent bg-red-100 text-[10px] text-red-800 dark:bg-red-950 dark:text-red-300'
                        }
                      >
                        {d.status_code ?? (d.ok ? 'OK' : t('noResponse'))}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{d.event}</span>
                      {d.resent_from ? (
                        <Badge className="border-border bg-muted text-muted-foreground text-[10px]">
                          {t('resentBadge')}
                        </Badge>
                      ) : null}
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {d.duration_ms != null ? `${d.duration_ms} ms · ` : ''}
                        {fmt(d.created_at)}
                      </span>
                    </button>

                    {isOpen ? (
                      <div className="bg-muted/30 space-y-3 px-4 py-3 text-xs">
                        {d.error ? (
                          <p className="text-red-700 dark:text-red-300">{d.error}</p>
                        ) : null}
                        {d.response_snippet ? (
                          <div>
                            <p className="text-muted-foreground mb-1 font-medium">{t('response')}</p>
                            <pre className="bg-card max-h-32 overflow-auto rounded border p-2 whitespace-pre-wrap">
                              {d.response_snippet}
                            </pre>
                          </div>
                        ) : null}
                        {d.payload ? (
                          <div>
                            <p className="text-muted-foreground mb-1 font-medium">{t('payload')}</p>
                            <pre className="bg-card max-h-48 overflow-auto rounded border p-2">
                              {JSON.stringify(d.payload, null, 2)}
                            </pre>
                          </div>
                        ) : null}
                        {d.payload ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={resending === d.id}
                            onClick={() => void resend(d)}
                          >
                            {resending === d.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <RotateCw className="size-3.5" />
                            )}
                            {t('resend')}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
