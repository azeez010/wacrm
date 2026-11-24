'use client';

// ============================================================
// WebhooksPanel - Settings → Webhooks
//
// Add a URL, pick the events it should receive, done. Each endpoint
// shows its health, can be paused, and has a delivery log (with resend).
// The signing secret is shown once, right after creating the webhook.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BookOpen, Check, Copy, Loader2, MoreHorizontal, Plus, Webhook as WebhookIcon } from 'lucide-react';

import { RequireRole } from '@/components/auth/require-role';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { SettingsPanelHead } from './settings-panel-head';
import { DeliveriesDialog } from './webhooks/deliveries-dialog';
import { EVENT_LABEL_KEY, MAX_CONSECUTIVE_FAILURES_UI, type Webhook } from './webhooks/types';
import { WebhookDialog } from './webhooks/webhook-dialog';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function WebhooksPanel() {
  const { canEditSettings } = useAuth();
  const t = useTranslations('Settings.webhooks');

  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ editing: Webhook | null; n: number } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [logFor, setLogFor] = useState<Webhook | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Webhook | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/webhooks', { cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('loadFailed'));
        return;
      }
      setHooks(payload.webhooks as Webhook[]);
    } catch {
      toast.error(t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setActive(w: Webhook, active: boolean) {
    // Optimistic; roll back on failure.
    setHooks((p) => p.map((x) => (x.id === w.id ? { ...x, is_active: active, failure_count: active ? 0 : x.failure_count } : x)));
    try {
      const res = await fetch(`/api/account/webhooks/${w.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: active }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error(t('saveFailed'));
      setHooks((p) => p.map((x) => (x.id === w.id ? w : x)));
    }
  }

  async function runDelete() {
    if (!confirmDelete) return;
    setWorking(true);
    try {
      const res = await fetch(`/api/account/webhooks/${confirmDelete.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('deleteFailed'));
        return;
      }
      toast.success(t('deleted'));
      setHooks((p) => p.filter((x) => x.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch {
      toast.error(t('networkError'));
    } finally {
      setWorking(false);
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  const disabledByFailures = (w: Webhook) =>
    !w.is_active && w.failure_count >= MAX_CONSECUTIVE_FAILURES_UI;

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <a href="/docs#tag/webhooks" target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline' })}>
              <BookOpen className="size-4" />
              {t('viewDocs')}
            </a>
            <RequireRole min="admin">
              <Button onClick={() => setDialog({ editing: null, n: Date.now() })}>
                <Plus className="size-4" />
                {t('add')}
              </Button>
            </RequireRole>
          </div>
        }
      />

      {hooks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <WebhookIcon className="text-muted-foreground size-6" />
            <p className="text-muted-foreground mt-2 text-sm">{t('empty')}</p>
            <p className="text-muted-foreground mt-1 text-xs">{canEditSettings ? t('emptyHint') : t('askAdmin')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-border divide-y">
              {hooks.map((w) => (
                <li key={w.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`truncate font-mono text-sm ${w.is_active ? 'text-foreground' : 'text-muted-foreground'}`}>{w.url}</span>
                      {disabledByFailures(w) ? (
                        <Badge className="border-transparent bg-red-100 text-[10px] text-red-800 dark:bg-red-950 dark:text-red-300">{t('disabledByFailures')}</Badge>
                      ) : !w.is_active ? (
                        <Badge className="border-border bg-muted text-muted-foreground text-[10px] uppercase">{t('paused')}</Badge>
                      ) : null}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {w.events.map((ev) => (
                        <Badge key={ev} className="border-border bg-muted text-muted-foreground text-[10px]">
                          {EVENT_LABEL_KEY[ev] ? t(EVENT_LABEL_KEY[ev]) : ev}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {w.last_delivery_at ? t('lastDelivery', { date: fmtDate(w.last_delivery_at) }) : t('noDeliveries')}
                      {w.is_active && w.failure_count > 0 ? ` · ${t('failuresInARow', { count: w.failure_count })}` : ''}
                    </p>
                  </div>

                  <RequireRole min="admin">
                    <Switch
                      checked={w.is_active}
                      onCheckedChange={(v) => void setActive(w, v === true)}
                      aria-label={t('toggle')}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t('more')} />}>
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setLogFor(w)}>{t('deliveries')}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDialog({ editing: w, n: Date.now() })}>{t('edit')}</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(w)}>{t('delete')}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </RequireRole>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {dialog ? (
        <WebhookDialog
          key={dialog.n}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
          onSaved={(w) => {
            setHooks((p) => p.map((x) => (x.id === w.id ? w : x)));
            setDialog(null);
          }}
          onCreated={(w, s) => {
            setHooks((p) => [w, ...p]);
            setDialog(null);
            setSecret(s);
          }}
        />
      ) : null}

      {logFor ? <DeliveriesDialog webhook={logFor} onClose={() => setLogFor(null)} onChanged={() => void load()} /> : null}

      <Dialog open={!!secret} onOpenChange={(o) => !o && setSecret(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('secretTitle')}</DialogTitle>
            <DialogDescription>{t('secretBody')}</DialogDescription>
          </DialogHeader>
          <div className="bg-muted flex items-center gap-2 rounded-md border p-2">
            <code className="min-w-0 flex-1 break-all text-xs">{secret}</code>
            <Button size="icon-sm" variant="outline" onClick={() => void copySecret()} aria-label={t('copy')}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">{t('secretVerify')}</p>
          <DialogFooter>
            <Button onClick={() => setSecret(null)}>{t('done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && !working && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('confirmDeleteTitle')}</DialogTitle>
            <DialogDescription className="break-all">{confirmDelete ? t('confirmDeleteBody', { url: confirmDelete.url }) : ''}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={working} onClick={() => setConfirmDelete(null)}>{t('cancel')}</Button>
            <Button variant="destructive" disabled={working} onClick={() => void runDelete()}>
              {working ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
