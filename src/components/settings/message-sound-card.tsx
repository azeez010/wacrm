'use client';

import { Play, Volume2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useSoundPref } from '@/hooks/use-browser-notifications';
import {
  SOUND_IDS,
  isSoundId,
  playSound,
  writeSoundPref,
} from '@/lib/notifications/sound';

/**
 * "Message sound" card - device-scoped sound for new customer messages
 * (played by the dashboard's notifications listener). On by default.
 */
export function MessageSoundCard({ className }: { className?: string }) {
  const t = useTranslations('Settings.messageSound');
  const pref = useSoundPref();
  const volumePct = Math.round(pref.volume * 100);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Volume2 className="size-4 text-muted-foreground" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{t('toggleLabel')}</p>
            <p className="text-xs text-muted-foreground">{t('toggleDesc')}</p>
          </div>
          <Switch
            checked={pref.enabled}
            onCheckedChange={(next) => writeSoundPref({ enabled: next })}
            aria-label={t('toggleLabel')}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">{t('soundLabel')}</p>
            <Select
              value={pref.sound}
              onValueChange={(v) => {
                if (!isSoundId(v)) return;
                writeSoundPref({ sound: v });
                playSound(v, pref.volume);
              }}
              disabled={!pref.enabled}
            >
              <SelectTrigger className="w-full" aria-label={t('soundLabel')}>
                <SelectValue>{t(`sounds.${pref.sound}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SOUND_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {t(`sounds.${id}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="message-sound-volume"
              className="flex items-center justify-between text-sm font-medium text-foreground"
            >
              {t('volumeLabel')}
              <span className="text-xs tabular-nums text-muted-foreground">{volumePct}%</span>
            </label>
            <input
              id="message-sound-volume"
              type="range"
              min={0}
              max={100}
              step={5}
              value={volumePct}
              disabled={!pref.enabled}
              onChange={(e) => writeSoundPref({ volume: Number(e.target.value) / 100 })}
              onPointerUp={() => playSound(pref.sound, pref.volume)}
              className="h-9 w-full accent-primary disabled:opacity-50"
            />
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => playSound(pref.sound, pref.volume)}
          disabled={!pref.enabled}
        >
          <Play className="size-4" />
          {t('preview')}
        </Button>
      </CardContent>
    </Card>
  );
}
