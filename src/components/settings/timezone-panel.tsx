'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Clock, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { browserTimeZone, isValidTimeZone, listTimeZones } from '@/lib/automations/time-of-day';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

/** Current date and time in a zone, for the live preview. */
function nowIn(zone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date());
  } catch {
    return '';
  }
}

/**
 * Settings → Account → Time zone. One zone for the whole account: "today",
 * "30 days ago" and "in 7 days" in contact filters and segments resolve
 * against it. Writes `accounts.timezone`; the `accounts_update` RLS policy
 * limits that to admins and above, so everyone else sees a read-only value.
 */
export function TimezonePanel() {
  const t = useTranslations('Settings.timezone');
  const supabase = createClient();
  const { accountId, accountTimezone, canEditSettings, profileLoading, refreshProfile } = useAuth();

  const [selected, setSelected] = useState(accountTimezone);
  const [saving, setSaving] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(accountTimezone);
  }, [accountTimezone]);

  // Keep the preview clock fresh.
  useEffect(() => {
    const handle = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(handle);
  }, []);

  const zones = useMemo(() => listTimeZones(selected), [selected]);
  const device = browserTimeZone();
  const dirty = selected !== accountTimezone;

  async function handleSave() {
    if (!accountId || !dirty || !isValidTimeZone(selected)) return;
    setSaving(true);
    const { error } = await supabase.from('accounts').update({ timezone: selected }).eq('id', accountId);
    if (error) {
      toast.error(t('saveFailed'));
      setSaving(false);
      return;
    }
    await refreshProfile();
    setSaving(false);
    toast.success(t('saveSuccess'));
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Clock className="size-4 text-primary" />
            {t('accountZone')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">{t('accountZoneDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-sm">
            <Label className="text-muted-foreground">{t('zoneLabel')}</Label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={!canEditSettings || profileLoading}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            {canEditSettings && device !== selected && (
              <button
                type="button"
                onClick={() => setSelected(device)}
                className="w-fit text-xs text-primary hover:underline"
              >
                {t('useDevice', { zone: device })}
              </button>
            )}
            {!canEditSettings && <p className="text-xs text-muted-foreground">{t('adminOnlyHint')}</p>}
          </div>

          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            {t('preview', { time: nowIn(selected) })}
          </p>

          {canEditSettings && (
            <Button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('save')
              )}
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
