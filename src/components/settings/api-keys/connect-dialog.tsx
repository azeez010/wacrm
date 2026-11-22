'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ConnectInstructions } from './connect-instructions';

/**
 * Setup instructions for one key, in a modal. Used right after creating a key
 * (`justCreated`) and when an admin re-opens a key after entering their password.
 */
export function ConnectDialog({
  open,
  onOpenChange,
  name,
  keyValue,
  justCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  /** null = a key created before keys could be re-shown (placeholder shown). */
  keyValue: string | null;
  justCreated: boolean;
}) {
  const t = useTranslations('Settings.apiKeys');
  async function copyKey() {
    if (!keyValue) return;
    try {
      await navigator.clipboard.writeText(keyValue);
      toast.success(t('copySuccess'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{justCreated ? t('createdTitle') : t('connectTitle', { name })}</DialogTitle>
          <DialogDescription>{justCreated ? t('createdNote') : keyValue ? t('connectDesc') : t('legacyNote')}</DialogDescription>
        </DialogHeader>
        <div className="-m-1 space-y-4 overflow-y-auto p-1">
          {keyValue ? (
            <div className="space-y-1.5">
              <span className="text-foreground text-xs font-medium">{t('keyLabel')}</span>
              <div className="flex gap-2">
                <Input readOnly value={keyValue} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                <Button type="button" variant="outline" onClick={copyKey}>
                  <Copy className="size-4" />
                  {t('copy')}
                </Button>
              </div>
            </div>
          ) : null}
          <ConnectInstructions keyValue={keyValue} />
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t('done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
