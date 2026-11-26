'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, PhoneOff } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

/**
 * Settings > WhatsApp: leave out numbers Meta reported undeliverable.
 * Writes `accounts.broadcast_skip_unreachable` (the accounts_update policy limits it to admins and above).
 */
export function ReachabilityCard() {
  const t = useTranslations('Settings.reachability');
  const { accountId, canEditSettings } = useAuth();
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void createClient()
      .from('accounts')
      .select('broadcast_skip_unreachable')
      .eq('id', accountId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setOn(data?.broadcast_skip_unreachable === true);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  async function toggle(next: boolean) {
    if (!accountId) return;
    setSaving(true);
    const { error } = await createClient().from('accounts').update({ broadcast_skip_unreachable: next }).eq('id', accountId);
    setSaving(false);
    if (error) return void toast.error(t('saveFailed'));
    setOn(next);
    toast.success(t('saved'));
  }

  if (on === null) return null;
  return (
    <Card className="mt-6">
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="text-foreground flex items-center gap-2 text-sm font-medium">
            <PhoneOff className="text-primary size-4" aria-hidden />
            {t('title')}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">{t('hint')}</p>
        </div>
        {saving ? <Loader2 className="size-4 animate-spin" /> : null}
        <Switch checked={on} disabled={!canEditSettings || saving} onCheckedChange={(v) => void toggle(v)} aria-label={t('title')} />
      </CardContent>
    </Card>
  );
}
