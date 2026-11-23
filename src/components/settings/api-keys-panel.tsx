'use client';

// ============================================================
// ApiKeysPanel - Settings → API & MCP
//
// One list of keys for both the REST API and MCP clients. Click a key
// (or Connect) to see how to connect an app: the admin confirms their
// password first, then gets the setup for the chosen client. New keys
// open the same setup right after they are created.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BookOpen, KeyRound, Loader2, MoreHorizontal, Plus } from 'lucide-react';

import { RequireRole } from '@/components/auth/require-role';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/use-auth';
import { presetFor } from '@/lib/api-keys/presets';
import { SettingsPanelHead } from './settings-panel-head';
import { ConnectDialog } from './api-keys/connect-dialog';
import { KeyDialog } from './api-keys/key-dialog';
import { PasswordDialog } from './api-keys/password-dialog';
import { keyStatus, type ApiKey } from './api-keys/types';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

type Confirm = { kind: 'revoke' | 'delete'; key: ApiKey } | null;

export function ApiKeysPanel() {
  const { canEditSettings } = useAuth();
  const t = useTranslations('Settings.apiKeys');

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [mcpIncluded, setMcpIncluded] = useState(true);
  const [dialog, setDialog] = useState<{ editing: ApiKey | null; n: number } | null>(null);
  const [pwKey, setPwKey] = useState<ApiKey | null>(null);
  const [connect, setConnect] = useState<{ name: string; value: string | null; justCreated: boolean } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/api-keys', { cache: 'no-store' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('loadFailed'));
        return;
      }
      const payload = (await res.json()) as { keys: ApiKey[]; mcp?: { included: boolean } };
      setKeys(payload.keys);
      setMcpIncluded(payload.mcp?.included !== false);
    } catch {
      toast.error(t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function open(k: ApiKey) {
    if (!canEditSettings || keyStatus(k) !== 'active') return;
    // Keys made before keys were stored can't be re-shown: skip the password, show the placeholder setup.
    if (k.has_secret) setPwKey(k);
    else setConnect({ name: k.name, value: null, justCreated: false });
  }

  async function runConfirm() {
    if (!confirm) return;
    const { kind, key } = confirm;
    setWorking(true);
    try {
      const res = await fetch(`/api/account/api-keys/${key.id}${kind === 'delete' ? '?permanent=1' : ''}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t(kind === 'delete' ? 'deleteFailed' : 'revokeFailed'));
        return;
      }
      toast.success(t(kind === 'delete' ? 'deleted' : 'revokedToast', { name: key.name }));
      if (kind === 'delete') setKeys((p) => p.filter((k) => k.id !== key.id));
      else setKeys((p) => p.map((k) => (k.id === key.id ? { ...k, revoked_at: new Date().toISOString() } : k)));
      setConfirm(null);
    } catch {
      toast.error(t('networkError'));
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  const accessLabel = (k: ApiKey) => {
    const p = presetFor(k.scopes);
    if (p === 'read') return t('accessRead');
    if (p === 'builder') return t('accessBuilder');
    if (p === 'developer') return t('accessDeveloper');
    if (p === 'full') return t('accessFull');
    return k.scopes.length === 0 ? t('noScopes') : t('accessCustom', { count: k.scopes.length });
  };

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <a href="/docs" target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline' })}>
              <BookOpen className="size-4" />
              {t('viewDocs')}
            </a>
            <RequireRole min="admin">
              <Button onClick={() => setDialog({ editing: null, n: Date.now() })}>
                <Plus className="size-4" />
                {t('newKey')}
              </Button>
            </RequireRole>
          </div>
        }
      />

      {keys.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <KeyRound className="text-muted-foreground size-6" />
            <p className="text-muted-foreground mt-2 text-sm">{t('empty')}</p>
            <p className="text-muted-foreground mt-1 text-xs">{canEditSettings ? t('emptyHint') : t('askAdmin')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-border divide-y">
              {keys.map((k) => {
                const status = keyStatus(k);
                const inactive = status !== 'active';
                return (
                  <li key={k.id} className="flex items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => open(k)}
                      disabled={inactive || !canEditSettings}
                      className="min-w-0 flex-1 text-left disabled:cursor-default"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`truncate text-sm font-medium ${inactive ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{k.name}</span>
                        <Badge className="border-border bg-muted text-muted-foreground text-[10px]">{accessLabel(k)}</Badge>
                        {status !== 'active' ? (
                          <Badge className="border-border bg-muted text-muted-foreground text-[10px] tracking-wide uppercase">{t(status === 'revoked' ? 'revoked' : 'expired')}</Badge>
                        ) : null}
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        <span className="font-mono">{k.key_prefix}…</span>
                        {' · '}
                        {k.last_used_at ? t('lastUsed', { date: fmtDate(k.last_used_at) }) : t('neverUsed')}
                        {' · '}
                        {t('created', { date: fmtDate(k.created_at) })}
                        {k.expires_at && status === 'active' ? ` · ${t('expires', { date: fmtDate(k.expires_at) })}` : ''}
                      </p>
                    </button>

                    <RequireRole min="admin">
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t('more')} />}>
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {status === 'active' ? (
                            <>
                              <DropdownMenuItem onClick={() => open(k)}>{t('connect')}</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setDialog({ editing: k, n: Date.now() })}>{t('edit')}</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: 'revoke', key: k })}>{t('revoke')}</DropdownMenuItem>
                            </>
                          ) : (
                            <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ kind: 'delete', key: k })}>{t('delete')}</DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </RequireRole>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {dialog ? (
        <KeyDialog
          key={dialog.n}
          open
          editing={dialog.editing}
          onClose={() => setDialog(null)}
          onSaved={(k) => {
            setKeys((p) => p.map((x) => (x.id === k.id ? { ...x, ...k } : x)));
            setDialog(null);
          }}
          onCreated={(k, plaintext) => {
            setKeys((p) => [k, ...p]);
            setDialog(null);
            setConnect({ name: k.name, value: plaintext, justCreated: true });
          }}
        />
      ) : null}

      <PasswordDialog
        keyId={pwKey?.id ?? null}
        name={pwKey?.name ?? ''}
        onClose={() => setPwKey(null)}
        onRevealed={(plaintext) => {
          if (pwKey) setConnect({ name: pwKey.name, value: plaintext, justCreated: false });
          setPwKey(null);
        }}
      />

      {connect ? <ConnectDialog open onOpenChange={(o) => !o && setConnect(null)} name={connect.name} keyValue={connect.value} justCreated={connect.justCreated} mcpIncluded={mcpIncluded} onUpgraded={() => void load()} /> : null}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && !working && setConfirm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirm ? t(confirm.kind === 'delete' ? 'confirmDeleteTitle' : 'confirmRevokeTitle', { name: confirm.key.name }) : ''}</DialogTitle>
            <DialogDescription>{confirm ? t(confirm.kind === 'delete' ? 'confirmDeleteBody' : 'confirmRevokeBody') : ''}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={working} onClick={() => setConfirm(null)}>{t('cancel')}</Button>
            <Button variant="destructive" disabled={working} onClick={() => void runConfirm()}>
              {working ? <Loader2 className="size-4 animate-spin" /> : null}
              {confirm ? t(confirm.kind === 'delete' ? 'delete' : 'revoke') : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
