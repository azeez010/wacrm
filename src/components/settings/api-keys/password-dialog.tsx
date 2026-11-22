'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';

/** Asks for the admin's password, then returns the key's plaintext (or null for older keys). */
export function PasswordDialog({
  keyId,
  name,
  onClose,
  onRevealed,
}: {
  keyId: string | null;
  name: string;
  onClose: () => void;
  onRevealed: (plaintext: string | null) => void;
}) {
  const t = useTranslations('Settings.apiKeys');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyId || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/account/api-keys/${keyId}/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const payload = (await res.json().catch(() => ({}))) as { plaintext?: string | null; error?: string };
      if (!res.ok) {
        setError(payload.error || t('networkError'));
        return;
      }
      setPassword('');
      onRevealed(payload.plaintext ?? null);
    } catch {
      setError(t('networkError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={!!keyId}
      onOpenChange={(o) => {
        if (!o) {
          setPassword('');
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="border-border bg-popover sm:max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('pwTitle')}</DialogTitle>
            <DialogDescription>{t('pwDesc', { name })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="api-key-pw" className="text-muted-foreground">{t('pwLabel')}</Label>
            <PasswordInput id="api-key-pw" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
            <Button type="submit" disabled={busy || !password}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('pwCta')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
