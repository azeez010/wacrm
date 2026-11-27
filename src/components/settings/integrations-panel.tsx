'use client';

// ============================================================
// IntegrationsPanel - Settings → Integrations (admins)
//
// Connect the business's own systems so the AI can use them while it replies:
// any MCP server, custom HTTP actions, Paystack payment links (Google Calendar
// comes with "Connect with Google"). Each tool is read (runs on its own) or an
// action (a teammate approves it, unless "Allow without approval" is on).
// Secrets are write-only: only hints like ••••1234 come back.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Calendar,
  CreditCard,
  Globe,
  Loader2,
  MoreHorizontal,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';

import { RequireRole } from '@/components/auth/require-role';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SettingsPanelHead } from './settings-panel-head';

type Kind = 'mcp' | 'http' | 'google_calendar' | 'paystack';
type ToolKind = 'read' | 'action';
type FieldType = 'string' | 'number' | 'integer' | 'boolean';

interface Tool {
  id: string;
  integration_id: string;
  name: string;
  title: string | null;
  description: string;
  input_schema: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
  kind: ToolKind;
  enabled: boolean;
  auto_approve: boolean;
  source: 'discovered' | 'defined' | 'builtin';
  config: { method?: string; url?: string };
}
interface Integration {
  id: string;
  kind: Kind;
  name: string;
  status: 'connected' | 'error' | 'needs_reauth' | 'disabled';
  config: Record<string, unknown>;
  secret_hints: Record<string, string>;
  last_ok_at: string | null;
  last_error: string | null;
  tools: Tool[];
}
interface Usage {
  used: number;
  limit: number | null;
  enabled: boolean;
  plan: string;
}
interface Call {
  id: string;
  tool_name: string;
  mode: string;
  kind: ToolKind;
  status: string;
  arguments: unknown;
  result: string | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}
interface Field {
  name: string;
  type: FieldType;
  description: string;
  required: boolean;
}

const KIND_ICON: Record<Kind, typeof Plug> = { mcp: Plug, http: Globe, google_calendar: Calendar, paystack: CreditCard };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const payload = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
  return payload;
}

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function IntegrationsPanel() {
  const t = useTranslations('Settings.integrations');
  const [items, setItems] = useState<Integration[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'connected' | 'activity'>('connected');
  const [adding, setAdding] = useState<Kind | null>(null);
  const [picker, setPicker] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ integrations: Integration[]; usage: Usage }>('/api/integrations');
      setItems(r.integrations);
      setUsage(r.usage);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const g = new URLSearchParams(window.location.search).get('google');
    if (!g) return;
    const ok = g === 'connected' || g === 'reconnected';
    (ok ? toast.success : toast.error)(t(`google.${g}`));
    const u = new URL(window.location.href);
    u.searchParams.delete('google');
    window.history.replaceState(null, '', u.toString());
  }, [t]);

  const atLimit = !!usage && usage.limit !== null && usage.used >= usage.limit;
  const canAdd = !!usage?.enabled && !atLimit;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <RequireRole min="admin">
            <Button onClick={() => setPicker(true)} disabled={!canAdd}>
              <Plus className="size-4" />
              {t('add')}
            </Button>
          </RequireRole>
        }
      />

      {usage && !usage.enabled ? (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-sm">{t('upgradeBody', { plan: usage.plan })}</p>
            <a href="/settings?tab=billing" className="text-primary text-sm font-medium underline-offset-4 hover:underline">
              {t('upgradeCta')}
            </a>
          </CardContent>
        </Card>
      ) : usage ? (
        <p className="text-muted-foreground text-xs">
          {usage.limit === null ? t('usageUnlimited', { used: usage.used }) : t('usage', { used: usage.used, limit: usage.limit })}
          {atLimit ? ` · ${t('atLimit')}` : ''}
        </p>
      ) : null}

      <SegmentedControl
        value={view}
        onChange={setView}
        options={[
          { value: 'connected', label: t('tabConnected') },
          { value: 'activity', label: t('tabActivity') },
        ]}
        aria-label={t('title')}
        className="w-fit"
      />

      {view === 'activity' ? (
        <ActivityList />
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Plug className="text-muted-foreground size-6" />
            <p className="text-muted-foreground mt-2 text-sm">{t('empty')}</p>
            <p className="text-muted-foreground mt-1 max-w-md text-xs">{t('emptyHint')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((i) => (
            <IntegrationCard
              key={i.id}
              integration={i}
              onChange={(next) => setItems((p) => p.map((x) => (x.id === next.id ? next : x)))}
              onRemoved={() => {
                setItems((p) => p.filter((x) => x.id !== i.id));
                setUsage((u) => (u ? { ...u, used: Math.max(0, u.used - 1) } : u));
              }}
            />
          ))}
        </div>
      )}

      <Dialog open={picker} onOpenChange={setPicker}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('pickTitle')}</DialogTitle>
            <DialogDescription>{t('pickBody')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['mcp', 'http', 'paystack', 'google_calendar'] as Kind[]).map((k) => {
              const Icon = KIND_ICON[k];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setPicker(false);
                    if (k === 'google_calendar') window.location.href = '/api/integrations/google/start';
                    else setAdding(k);
                  }}
                  className="hover:bg-muted flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="size-4" />
                    {t(`kinds.${k}`)}
                  </span>
                  <span className="text-muted-foreground text-xs">{t(`kindHelp.${k}`)}</span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {adding && adding !== 'google_calendar' ? (
        <AddDialog
          kind={adding}
          onClose={() => setAdding(null)}
          onCreated={(i) => {
            setItems((p) => [...p, i]);
            setUsage((u) => (u ? { ...u, used: u.used + 1 } : u));
            setAdding(null);
          }}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- one integration

function IntegrationCard({ integration: i, onChange, onRemoved }: { integration: Integration; onChange: (i: Integration) => void; onRemoved: () => void }) {
  const t = useTranslations('Settings.integrations');
  const Icon = KIND_ICON[i.kind];
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [testing, setTesting] = useState<Tool | null>(null);
  const [actionDialog, setActionDialog] = useState<{ tool: Tool | null } | null>(null);

  const patchTool = async (tool: Tool, patch: Partial<Pick<Tool, 'enabled' | 'auto_approve' | 'kind'>>) => {
    const optimistic = { ...tool, ...patch, ...(patch.kind === 'read' ? { auto_approve: false } : {}) };
    onChange({ ...i, tools: i.tools.map((x) => (x.id === tool.id ? optimistic : x)) });
    try {
      const r = await api<{ tool: Tool }>(`/api/integrations/${i.id}/tools/${tool.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      onChange({ ...i, tools: i.tools.map((x) => (x.id === tool.id ? r.tool : x)) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('saveFailed'));
      onChange(i);
    }
  };

  const rediscover = async () => {
    setBusy(true);
    try {
      const r = await api<{ tools: Tool[]; added: number; removed: number }>(`/api/integrations/${i.id}/discover`, { method: 'POST' });
      onChange({ ...i, status: 'connected', last_error: null, tools: r.tools });
      toast.success(t('rediscovered', { added: r.added, removed: r.removed }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const setPaused = async (paused: boolean) => {
    try {
      const r = await api<{ integration: Integration }>(`/api/integrations/${i.id}`, { method: 'PATCH', body: JSON.stringify({ status: paused ? 'disabled' : 'connected' }) });
      onChange({ ...i, ...r.integration, tools: i.tools });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('saveFailed'));
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/api/integrations/${i.id}`, { method: 'DELETE' });
      toast.success(t('removed'));
      onRemoved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  const removeTool = async (tool: Tool) => {
    try {
      await api(`/api/integrations/${i.id}/tools/${tool.id}`, { method: 'DELETE' });
      onChange({ ...i, tools: i.tools.filter((x) => x.id !== tool.id) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('saveFailed'));
    }
  };

  const statusBadge =
    i.status === 'connected' ? (
      <Badge className="border-transparent bg-emerald-100 text-[10px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{t('status.connected')}</Badge>
    ) : i.status === 'disabled' ? (
      <Badge className="border-border bg-muted text-muted-foreground text-[10px]">{t('status.disabled')}</Badge>
    ) : (
      <Badge className="border-transparent bg-red-100 text-[10px] text-red-800 dark:bg-red-950 dark:text-red-300">{t(`status.${i.status}`)}</Badge>
    );

  const detail =
    i.kind === 'mcp'
      ? String(i.config.url ?? '')
      : i.kind === 'paystack'
        ? `${String(i.config.currency ?? 'NGN')} · ${i.config.mode === 'test' ? t('testKey') : t('liveKey')} · ${i.secret_hints.secret_key ?? ''}`
        : i.kind === 'google_calendar'
          ? `${String(i.config.email ?? '')} · ${String(i.config.timezone ?? '')}`
          : i.kind === 'http'
          ? (Array.isArray(i.config.header_names) && i.config.header_names.length ? t('headersSaved', { names: (i.config.header_names as string[]).join(', ') }) : t('noHeaders'))
          : '';

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{i.name}</span>
              <Badge className="border-border bg-muted text-muted-foreground text-[10px]">{t(`kinds.${i.kind}`)}</Badge>
              {statusBadge}
            </div>
            <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">{detail}</p>
            {i.last_error && i.status !== 'connected' ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{i.last_error}</p> : null}
          </div>
          <RequireRole min="admin">
            <Switch checked={i.status !== 'disabled'} onCheckedChange={(v) => void setPaused(v !== true)} aria-label={t('toggle')} />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t('more')} disabled={busy} />}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {i.kind === 'mcp' ? (
                  <DropdownMenuItem onClick={() => void rediscover()}>
                    <RefreshCw className="size-4" />
                    {t('rediscover')}
                  </DropdownMenuItem>
                ) : null}
                {i.kind === 'google_calendar' ? (
                  <DropdownMenuItem onClick={() => { window.location.href = '/api/integrations/google/start?reconnect=1'; }}>
                    <RefreshCw className="size-4" />
                    {t('reconnect')}
                  </DropdownMenuItem>
                ) : null}
                {i.kind === 'http' ? (
                  <DropdownMenuItem onClick={() => setActionDialog({ tool: null })}>
                    <Plus className="size-4" />
                    {t('addAction')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => setEditing(true)}>{t('edit')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setConfirmRemove(true)}>
                  {t('remove')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </RequireRole>
        </div>

        {i.tools.length === 0 ? (
          <p className="text-muted-foreground text-xs">{i.kind === 'http' ? t('noActions') : t('noTools')}</p>
        ) : (
          <ul className="divide-border divide-y rounded-md border">
            {i.tools.map((tool) => (
              <li key={tool.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <Switch checked={tool.enabled} onCheckedChange={(v) => void patchTool(tool, { enabled: v === true })} aria-label={t('toolEnabled')} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-sm ${tool.enabled ? '' : 'text-muted-foreground'}`}>{tool.title || tool.name}</span>
                    {tool.config.method ? <code className="text-muted-foreground text-[10px]">{tool.config.method}</code> : null}
                  </div>
                  {tool.description ? <p className="text-muted-foreground line-clamp-2 text-xs">{tool.description}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SegmentedControl<ToolKind>
                    value={tool.kind}
                    onChange={(k) => void patchTool(tool, { kind: k })}
                    options={[
                      { value: 'read', label: t('read') },
                      { value: 'action', label: t('action') },
                    ]}
                    aria-label={t('kindLabel')}
                    noTruncate
                  />
                  {tool.kind === 'action' ? (
                    <label className="flex items-center gap-1.5 text-xs" title={t('autoApproveHelp')}>
                      <Switch checked={tool.auto_approve} onCheckedChange={(v) => void patchTool(tool, { auto_approve: v === true })} aria-label={t('autoApprove')} />
                      {t('autoApprove')}
                    </label>
                  ) : (
                    <span className="text-muted-foreground text-xs">{t('runsAutomatically')}</span>
                  )}
                  <Button variant="ghost" size="icon-sm" onClick={() => setTesting(tool)} aria-label={t('test')} title={t('test')}>
                    <Play className="size-4" />
                  </Button>
                  {tool.source === 'defined' ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setActionDialog({ tool })}>
                        {t('edit')}
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => void removeTool(tool)} aria-label={t('remove')}>
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {editing ? <EditDialog integration={i} onClose={() => setEditing(false)} onSaved={(n) => { onChange({ ...i, ...n, tools: i.tools }); setEditing(false); }} /> : null}
      {testing ? <TestDialog integrationId={i.id} tool={testing} onClose={() => setTesting(null)} /> : null}
      {actionDialog ? (
        <ActionDialog
          integrationId={i.id}
          tool={actionDialog.tool}
          onClose={() => setActionDialog(null)}
          onSaved={(tool) => {
            onChange({ ...i, tools: actionDialog.tool ? i.tools.map((x) => (x.id === tool.id ? tool : x)) : [...i.tools, tool] });
            setActionDialog(null);
          }}
        />
      ) : null}

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('removeTitle', { name: i.name })}</DialogTitle>
            <DialogDescription>{t('removeBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={busy}>
              {t('remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------- add / edit

function HeaderRows({ rows, onChange, hints }: { rows: { name: string; value: string }[]; onChange: (r: { name: string; value: string }[]) => void; hints?: Record<string, string> }) {
  const t = useTranslations('Settings.integrations');
  return (
    <div className="space-y-2">
      <Label>{t('headers')}</Label>
      {rows.map((r, idx) => (
        <div key={idx} className="flex gap-2">
          <Input value={r.name} placeholder="X-Api-Key" className="w-40" onChange={(e) => onChange(rows.map((x, j) => (j === idx ? { ...x, name: e.target.value } : x)))} />
          <PasswordInput
            value={r.value}
            placeholder={hints?.[`header:${r.name}`] ? t('keepSaved', { hint: hints[`header:${r.name}`] }) : t('headerValue')}
            onChange={(e) => onChange(rows.map((x, j) => (j === idx ? { ...x, value: e.target.value } : x)))}
          />
          <Button variant="ghost" size="icon-sm" onClick={() => onChange(rows.filter((_, j) => j !== idx))} aria-label={t('remove')}>
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...rows, { name: '', value: '' }])}>
        <Plus className="size-4" />
        {t('addHeader')}
      </Button>
      <p className="text-muted-foreground text-xs">{t('headersHelp')}</p>
    </div>
  );
}

function AddDialog({ kind, onClose, onCreated }: { kind: Exclude<Kind, 'google_calendar'>; onClose: () => void; onCreated: (i: Integration) => void }) {
  const t = useTranslations('Settings.integrations');
  const [name, setName] = useState(kind === 'paystack' ? 'Paystack' : '');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [headerName, setHeaderName] = useState('');
  const [headers, setHeaders] = useState<{ name: string; value: string }[]>([]);
  const [secretKey, setSecretKey] = useState('');
  const [currency, setCurrency] = useState('NGN');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const body =
        kind === 'mcp'
          ? { kind, name, url, ...(token ? { token } : {}), ...(headerName ? { header_name: headerName } : {}) }
          : kind === 'http'
            ? { kind, name, headers: headers.filter((h) => h.name) }
            : { kind, name, secret_key: secretKey, currency: currency.toUpperCase() };
      const r = await api<{ integration: Integration }>('/api/integrations', { method: 'POST', body: JSON.stringify(body) });
      toast.success(kind === 'mcp' ? t('connectedTools', { count: r.integration.tools.length }) : t('connected'));
      onCreated(r.integration);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('addTitle', { kind: t(`kinds.${kind}`) })}</DialogTitle>
          <DialogDescription>{t(`kindHelp.${kind}`)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="int-name">{t('name')}</Label>
            <Input id="int-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t(`namePlaceholder.${kind}`)} />
          </div>
          {kind === 'mcp' ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="int-url">{t('mcpUrl')}</Label>
                <Input id="int-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="int-token">{t('mcpToken')}</Label>
                <PasswordInput id="int-token" value={token} onChange={(e) => setToken(e.target.value)} placeholder={t('optional')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="int-header">{t('mcpHeader')}</Label>
                <Input id="int-header" value={headerName} onChange={(e) => setHeaderName(e.target.value)} placeholder="Authorization" />
                <p className="text-muted-foreground text-xs">{t('mcpHeaderHelp')}</p>
              </div>
            </>
          ) : null}
          {kind === 'http' ? (
            <>
              <HeaderRows rows={headers} onChange={setHeaders} />
              <p className="text-muted-foreground text-xs">{t('httpAfterCreate')}</p>
            </>
          ) : null}
          {kind === 'paystack' ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="int-key">{t('paystackKey')}</Label>
                <PasswordInput id="int-key" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder="sk_live_…" />
                <p className="text-muted-foreground text-xs">{t('paystackKeyHelp')}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="int-cur">{t('currency')}</Label>
                <Input id="int-cur" value={currency} maxLength={3} className="w-24 uppercase" onChange={(e) => setCurrency(e.target.value)} />
              </div>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {kind === 'mcp' ? t('connectAndDiscover') : t('connect')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ integration: i, onClose, onSaved }: { integration: Integration; onClose: () => void; onSaved: (i: Integration) => void }) {
  const t = useTranslations('Settings.integrations');
  const [name, setName] = useState(i.name);
  const [url, setUrl] = useState(String(i.config.url ?? ''));
  const [token, setToken] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [currency, setCurrency] = useState(String(i.config.currency ?? 'NGN'));
  const [headers, setHeaders] = useState<{ name: string; value: string }[]>(
    (Array.isArray(i.config.header_names) ? (i.config.header_names as string[]) : []).map((n) => ({ name: n, value: '' })),
  );
  const [cal, setCal] = useState({
    timezone: String(i.config.timezone ?? 'Africa/Lagos'),
    calendar_id: String(i.config.calendar_id ?? 'primary'),
    slot_minutes: Number(i.config.slot_minutes ?? 30),
    day_start: String(i.config.day_start ?? '09:00'),
    day_end: String(i.config.day_end ?? '17:00'),
    work_days: Array.isArray(i.config.work_days) ? (i.config.work_days as number[]) : [1, 2, 3, 4, 5],
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name };
      if (i.kind === 'google_calendar') Object.assign(body, cal);
      if (i.kind === 'mcp') {
        if (url !== i.config.url) body.url = url;
        if (token) body.token = token;
      }
      if (i.kind === 'http') body.headers = headers.filter((h) => h.name);
      if (i.kind === 'paystack') {
        if (secretKey) body.secret_key = secretKey;
        body.currency = currency.toUpperCase();
      }
      const r = await api<{ integration: Integration }>(`/api/integrations/${i.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast.success(t('saved'));
      onSaved({ ...i, ...r.integration });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('editTitle', { name: i.name })}</DialogTitle>
          <DialogDescription>{t('secretsWriteOnly')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">{t('name')}</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {i.kind === 'mcp' ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="edit-url">{t('mcpUrl')}</Label>
                <Input id="edit-url" value={url} onChange={(e) => setUrl(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-token">{t('mcpToken')}</Label>
                <PasswordInput id="edit-token" value={token} onChange={(e) => setToken(e.target.value)} placeholder={i.secret_hints.token ? t('keepSaved', { hint: i.secret_hints.token }) : t('optional')} />
              </div>
            </>
          ) : null}
          {i.kind === 'http' ? <HeaderRows rows={headers} onChange={setHeaders} hints={i.secret_hints} /> : null}
          {i.kind === 'google_calendar' ? (
            <div className="space-y-3">
              <p className="text-muted-foreground text-xs">{t('calendarHelp')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cal-tz">{t('timezone')}</Label>
                  <Input id="cal-tz" value={cal.timezone} onChange={(e) => setCal({ ...cal, timezone: e.target.value })} placeholder="Africa/Lagos" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cal-id">{t('calendarId')}</Label>
                  <Input id="cal-id" value={cal.calendar_id} onChange={(e) => setCal({ ...cal, calendar_id: e.target.value })} placeholder="primary" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cal-start">{t('opens')}</Label>
                  <Input id="cal-start" type="time" value={cal.day_start} onChange={(e) => setCal({ ...cal, day_start: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cal-end">{t('closes')}</Label>
                  <Input id="cal-end" type="time" value={cal.day_end} onChange={(e) => setCal({ ...cal, day_end: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cal-slot">{t('slotMinutes')}</Label>
                  <Input id="cal-slot" type="number" min={10} max={240} value={cal.slot_minutes} onChange={(e) => setCal({ ...cal, slot_minutes: Number(e.target.value) || 30 })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t('workDays')}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                    const on = cal.work_days.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setCal({ ...cal, work_days: on ? cal.work_days.filter((x) => x !== d) : [...cal.work_days, d] })}
                        className={`rounded-md border px-2.5 py-1 text-xs ${on ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground'}`}
                      >
                        {t(`days.${d}`)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
          {i.kind === 'paystack' ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="edit-key">{t('paystackKey')}</Label>
                <PasswordInput id="edit-key" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder={t('keepSaved', { hint: i.secret_hints.secret_key ?? '••••' })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-cur">{t('currency')}</Label>
                <Input id="edit-cur" value={currency} maxLength={3} className="w-24 uppercase" onChange={(e) => setCurrency(e.target.value)} />
              </div>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function fieldsOf(tool: Tool | null): Field[] {
  const props = tool?.input_schema?.properties ?? {};
  const req = new Set(tool?.input_schema?.required ?? []);
  return Object.entries(props).map(([n, p]) => ({
    name: n,
    type: (['string', 'number', 'integer', 'boolean'].includes(p.type ?? '') ? p.type : 'string') as FieldType,
    description: p.description ?? '',
    required: req.has(n),
  }));
}

function ActionDialog({ integrationId, tool, onClose, onSaved }: { integrationId: string; tool: Tool | null; onClose: () => void; onSaved: (t: Tool) => void }) {
  const t = useTranslations('Settings.integrations');
  const [name, setName] = useState(tool?.name ?? '');
  const [description, setDescription] = useState(tool?.description ?? '');
  const [method, setMethod] = useState(tool?.config.method ?? 'POST');
  const [url, setUrl] = useState(tool?.config.url ?? '');
  const [kind, setKind] = useState<ToolKind>(tool?.kind ?? 'action');
  const [fields, setFields] = useState<Field[]>(fieldsOf(tool));
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const definition = { name, description, method, url, kind, fields: fields.filter((f) => f.name) };
    try {
      const r = tool
        ? await api<{ tool: Tool }>(`/api/integrations/${integrationId}/tools/${tool.id}`, { method: 'PATCH', body: JSON.stringify({ definition }) })
        : await api<{ tool: Tool }>(`/api/integrations/${integrationId}/tools`, { method: 'POST', body: JSON.stringify(definition) });
      toast.success(t('saved'));
      onSaved(r.tool);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tool ? t('editAction') : t('addAction')}</DialogTitle>
          <DialogDescription>{t('actionHelp')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="act-name">{t('actionName')}</Label>
              <Input id="act-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="check_order" className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('kindLabel')}</Label>
              <SegmentedControl<ToolKind>
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'read', label: t('read') },
                  { value: 'action', label: t('action') },
                ]}
                noTruncate
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="act-desc">{t('actionDescription')}</Label>
            <Textarea id="act-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={t('actionDescriptionPlaceholder')} />
          </div>
          <div className="flex gap-2">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="border-input bg-background h-9 rounded-md border px-2 text-sm" aria-label={t('method')}>
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/orders/{{order_id}}" className="font-mono text-xs" />
          </div>
          <p className="text-muted-foreground text-xs">{t('urlHelp', { example: '{{field}}' })}</p>

          <div className="space-y-2">
            <Label>{t('fields')}</Label>
            {fields.map((f, idx) => {
              const set = (p: Partial<Field>) => setFields((all) => all.map((x, j) => (j === idx ? { ...x, ...p } : x)));
              return (
                <div key={idx} className="flex flex-wrap items-center gap-2">
                  <Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="order_id" className="w-32 font-mono text-xs" />
                  <select value={f.type} onChange={(e) => set({ type: e.target.value as FieldType })} className="border-input bg-background h-9 rounded-md border px-2 text-xs" aria-label={t('fieldType')}>
                    {(['string', 'number', 'integer', 'boolean'] as FieldType[]).map((ft) => (
                      <option key={ft} value={ft}>
                        {t(`fieldTypes.${ft}`)}
                      </option>
                    ))}
                  </select>
                  <Input value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder={t('fieldDescription')} className="min-w-40 flex-1 text-xs" />
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={f.required} onChange={(e) => set({ required: e.target.checked })} />
                    {t('required')}
                  </label>
                  <Button variant="ghost" size="icon-sm" onClick={() => setFields((all) => all.filter((_, j) => j !== idx))} aria-label={t('remove')}>
                    <X className="size-4" />
                  </Button>
                </div>
              );
            })}
            <Button variant="outline" size="sm" onClick={() => setFields((all) => [...all, { name: '', type: 'string', description: '', required: false }])}>
              <Plus className="size-4" />
              {t('addField')}
            </Button>
            <p className="text-muted-foreground text-xs">{t('fieldsHelp')}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={saving || !name.trim() || !url.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- test run

function TestDialog({ integrationId, tool, onClose }: { integrationId: string; tool: Tool; onClose: () => void }) {
  const t = useTranslations('Settings.integrations');
  const fields = useMemo(() => fieldsOf(tool), [tool]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; result: string; durationMs: number } | null>(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    const args: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.name];
      if (v === undefined || v === '') continue;
      args[f.name] = f.type === 'number' || f.type === 'integer' ? Number(v) : f.type === 'boolean' ? v === 'true' : v;
    }
    try {
      setResult(await api(`/api/integrations/${integrationId}/tools/${tool.id}/test`, { method: 'POST', body: JSON.stringify({ arguments: args }) }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('testTitle', { name: tool.title || tool.name })}</DialogTitle>
          <DialogDescription>{tool.kind === 'action' ? t('testActionWarning') : t('testReadHelp')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {fields.length === 0 ? <p className="text-muted-foreground text-xs">{t('noInputs')}</p> : null}
          {fields.map((f) => (
            <div key={f.name} className="space-y-1">
              <Label htmlFor={`test-${f.name}`}>
                {f.name}
                {f.required ? ' *' : ''}
              </Label>
              <Input
                id={`test-${f.name}`}
                value={values[f.name] ?? ''}
                inputMode={f.type === 'number' || f.type === 'integer' ? 'decimal' : undefined}
                placeholder={f.type === 'boolean' ? 'true / false' : f.description}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            </div>
          ))}
          {result ? (
            <div className={`rounded-md border p-2 ${result.ok ? '' : 'border-red-300 dark:border-red-900'}`}>
              <p className="mb-1 text-xs font-medium">{result.ok ? t('testOk', { ms: result.durationMs }) : t('testFailed', { ms: result.durationMs })}</p>
              <pre className="bg-muted max-h-64 overflow-auto rounded p-2 text-[11px] whitespace-pre-wrap">{result.result}</pre>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('close')}
          </Button>
          <Button onClick={() => void run()} disabled={running}>
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {t('run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- activity

function ActivityList() {
  const t = useTranslations('Settings.integrations');
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api<{ calls: Call[] }>('/api/integrations/activity')
      .then((r) => setCalls(r.calls))
      .catch(() => setCalls([]));
  }, []);

  if (!calls) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="text-primary size-5 animate-spin" />
      </div>
    );
  }
  if (calls.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-10 text-center text-sm">{t('noActivity')}</CardContent>
      </Card>
    );
  }
  const tone: Record<string, string> = {
    ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    error: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    rejected: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    pending_approval: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  };
  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-border divide-y">
          {calls.map((c) => (
            <li key={c.id} className="px-4 py-2.5">
              <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen(open === c.id ? null : c.id)}>
                <span className="min-w-0 flex-1 truncate text-sm">{c.tool_name}</span>
                <Badge className={`border-transparent text-[10px] ${tone[c.status] ?? 'bg-muted text-muted-foreground'}`}>{t(`callStatus.${c.status}`)}</Badge>
                <span className="text-muted-foreground text-xs">{t(`modes.${c.mode}`)}</span>
                {c.duration_ms !== null ? <span className="text-muted-foreground text-xs">{c.duration_ms} ms</span> : null}
                <span className="text-muted-foreground text-xs">{fmt(c.created_at)}</span>
              </button>
              {open === c.id ? (
                <div className="mt-2 space-y-1">
                  <pre className="bg-muted overflow-auto rounded p-2 text-[11px]">{JSON.stringify(c.arguments, null, 2)}</pre>
                  {c.result || c.error ? <pre className="bg-muted max-h-48 overflow-auto rounded p-2 text-[11px] whitespace-pre-wrap">{c.result || c.error}</pre> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
