'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

/** Your profile > marketing emails. Applies the moment you flip it; account and billing emails are never affected. */
export function MarketingCard({ className }: { className?: string }) {
  const t = useTranslations('Settings.marketing');
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/account/marketing', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { opt_in?: boolean } | null) => {
        if (!cancelled && d) setOn(Boolean(d.opt_in));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (on === null) return null;

  async function change(next: boolean) {
    const prev = on;
    setOn(next);
    setBusy(true);
    try {
      const res = await fetch('/api/account/marketing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ opt_in: next }) });
      if (!res.ok) throw new Error('save failed');
      toast.success(next ? t('on') : t('off'));
    } catch {
      setOn(prev);
      toast.error(t('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={className}>
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <div>
          <p id="marketing-switch-label" className="text-foreground text-sm font-medium">{t('title')}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">{t('hint')}</p>
        </div>
        <Switch checked={on} disabled={busy} onCheckedChange={(v) => void change(Boolean(v))} aria-labelledby="marketing-switch-label" />
      </CardContent>
    </Card>
  );
}
