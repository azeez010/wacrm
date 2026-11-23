'use client';

import { Download, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useCan } from '@/hooks/use-can';
import { createClient } from '@/lib/supabase/client';
import type { FormField } from '@/lib/forms/types';

interface Stats {
  visited: number;
  started: number;
  attempted: number;
  submitted: number;
  qualified: number;
  blocked: number;
  by_source: { key: string; count: number }[];
  by_campaign: { key: string; count: number }[];
  by_country: { key: string; count: number }[];
  by_device: { key: string; count: number }[];
  rejected: { key: string; count: number }[];
  daily: { day: string; views: number; submissions: number }[];
}

interface Submission {
  id: string;
  contact_id: string | null;
  answers: Record<string, { label: string; value: unknown }>;
  score: number;
  qualified: boolean | null;
  outcome: string;
  reject_reason: string | null;
  is_repeat: boolean;
  utm: Record<string, string>;
  country: string | null;
  referrer: string | null;
  processing: { steps?: Record<string, { ok?: boolean; error?: string; skipped?: string }> } | null;
  created_at: string;
}

const RANGES = [7, 30, 90] as const;

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v);
  const flat = s.replace(/\r?\n/g, ' ');
  return /[",]/.test(flat) ? `"${flat.replace(/"/g, '""')}"` : flat;
}

/** One screen: four numbers, one grouping dropdown, the submissions table. */
export function Results({ formId, fields }: { formId: string; fields: FormField[] }) {
  const t = useTranslations('Forms.results');
  const canManage = useCan('manage-forms');
  const canDelete = useCan('delete-forms');
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [group, setGroup] = useState<'by_source' | 'by_campaign' | 'by_country' | 'by_device' | 'rejected'>('by_source');
  const [held, setHeld] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<Submission[] | null>(null);
  const [selected, setSelected] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);

  const kindOf = useMemo(() => new Map(fields.map((f) => [f.id, f.kind])), [fields]);

  const load = useCallback(async () => {
    const db = createClient();
    const to = new Date(Date.now() + 86_400_000);
    const from = new Date(Date.now() - days * 86_400_000);
    const [s, r, b, h] = await Promise.all([
      db.rpc('form_stats', { p_form_id: formId, p_from: from.toISOString(), p_to: to.toISOString() }),
      db
        .from('form_submissions')
        .select('id, contact_id, answers, score, qualified, outcome, reject_reason, is_repeat, utm, country, referrer, processing, created_at')
        .eq('form_id', formId)
        .eq('is_test', false)
        .gte('created_at', from.toISOString())
        .order('created_at', { ascending: false })
        .limit(500),
      db.rpc('form_breakdown', { p_form_id: formId, p_from: from.toISOString(), p_to: to.toISOString() }),
      db.from('form_submissions').select('id', { count: 'exact', head: true }).eq('form_id', formId).eq('outcome', 'held').eq('is_test', false),
    ]);
    setHeld(h.count ?? 0);
    const extra = (b.data as { by_device?: Stats['by_device']; rejected?: Stats['rejected'] } | null) ?? {};
    setStats(s.data ? ({ ...(s.data as Stats), by_device: extra.by_device ?? [], rejected: extra.rejected ?? [], daily: (s.data as Stats).daily ?? [] }) : null);
    setRows((r.data as Submission[] | null) ?? []);
  }, [formId, days]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const pick = (s: Submission, kind: string) => {
    for (const [id, a] of Object.entries(s.answers ?? {})) if (kindOf.get(id) === kind) return String(a.value ?? '');
    return '';
  };

  async function act(action: 'retry' | 'release' | 'spam', blockNumber = false) {
    if (!selected) return;
    setBusy(true);
    const res = await fetch(`/api/forms/${formId}/submissions/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, blockNumber }),
    });
    setBusy(false);
    if (!res.ok) return toast.error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? t('actionFailed'));
    toast.success(t(`done.${action}`));
    setSelected(null);
    setTimeout(() => void load(), 1500);
  }

  async function releaseAll() {
    setBusy(true);
    const res = await fetch(`/api/forms/${formId}/release-all`, { method: 'POST' });
    setBusy(false);
    const json = (await res.json().catch(() => ({}))) as { released?: number; still_held?: number; error?: string };
    if (!res.ok) return toast.error(json.error ?? t('actionFailed'));
    if (!json.released) toast.message(t('releasedNone'));
    else toast.success(t('released', { count: json.released }));
    setTimeout(() => void load(), 1500);
  }

  async function remove() {
    if (!selected) return;
    setBusy(true);
    const res = await fetch(`/api/forms/${formId}/submissions/${selected.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) return toast.error(t('actionFailed'));
    setSelected(null);
    void load();
  }

  function exportCsv() {
    if (!rows) return;
    const labels = [...new Set(rows.flatMap((r) => Object.values(r.answers ?? {}).map((a) => a.label)))];
    const header = ['date', 'name', 'phone', 'email', 'outcome', 'qualified', 'score', 'source', 'campaign', 'country', ...labels];
    const lines = [header.map(csvCell).join(',')];
    for (const r of rows) {
      const byLabel = Object.fromEntries(Object.values(r.answers ?? {}).map((a) => [a.label, a.value]));
      lines.push(
        [r.created_at, pick(r, 'name'), pick(r, 'phone'), pick(r, 'email'), r.outcome, r.qualified ?? '', r.score, r.utm?.source ?? '', r.utm?.campaign ?? '', r.country ?? '', ...labels.map((l) => byLabel[l])]
          .map(csvCell)
          .join(','),
      );
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
    a.download = `form-${formId.slice(0, 8)}-leads.csv`;
    a.click();
  }

  if (!stats || !rows) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  const tiles: [string, number][] = [
    [t('visited'), stats.visited],
    [t('started'), stats.started],
    [t('submitted'), stats.submitted],
    [t('qualified'), stats.qualified],
  ];
  const grouped = stats[group] ?? [];
  const groupLabel = (key: string) => {
    if (group === 'rejected') return t.has(`reason.${key.replace(/[()]/g, '')}`) ? t(`reason.${key.replace(/[()]/g, '')}`) : key;
    if (group === 'by_device') return t.has(`device.${key.replace(/[()]/g, '')}`) ? t(`device.${key.replace(/[()]/g, '')}`) : key;
    return key;
  };
  const max = Math.max(1, ...grouped.map((g) => g.count));
  const failed = selected ? Object.entries(selected.processing?.steps ?? {}).filter(([, s]) => s.ok === false) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {RANGES.map((d) => (
            <Button key={d} size="sm" variant={days === d ? 'default' : 'outline'} onClick={() => setDays(d)}>
              {t('lastDays', { days: d })}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!canManage || rows.length === 0}>
          <Download className="size-4" />
          {t('export')}
        </Button>
      </div>

      {held > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
          <span className="text-amber-700 dark:text-amber-400">{t('heldBanner', { count: held })}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" render={<Link href="/settings?tab=billing" />}>
              {t('seePlans')}
            </Button>
            <Button size="sm" disabled={!canManage || busy} onClick={() => void releaseAll()}>
              {t('releaseAll')}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <div className="text-2xl font-semibold text-foreground">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm font-medium">{t('dailyTitle')}</span>
          <span className="text-xs text-muted-foreground">{t('dailyTotal', { count: stats.daily.reduce((n, d) => n + d.submissions, 0) })}</span>
        </div>
        <DailyBars daily={stats.daily} />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium">{t('whereFrom')}</span>
          <select className="h-8 rounded-md border border-border bg-muted px-2 text-sm" value={group} onChange={(e) => setGroup(e.target.value as typeof group)}>
            <option value="by_source">{t('bySource')}</option>
            <option value="by_campaign">{t('byCampaign')}</option>
            <option value="by_country">{t('byCountry')}</option>
            <option value="by_device">{t('byDevice')}</option>
            <option value="rejected">{t('byRejected')}</option>
          </select>
        </div>
        {grouped.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noData')}</p>
        ) : (
          <ul className="space-y-2">
            {grouped.map((g) => (
              <li key={g.key} className="text-sm">
                <div className="flex justify-between">
                  <span className="truncate">{groupLabel(g.key)}</span>
                  <span className="text-muted-foreground">{g.count}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(g.count / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2">{t('colDate')}</th>
              <th className="px-3 py-2">{t('colName')}</th>
              <th className="px-3 py-2">{t('colPhone')}</th>
              <th className="px-3 py-2">{t('colSource')}</th>
              <th className="px-3 py-2">{t('colStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  {t('empty')}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} onClick={() => setSelected(r)} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/50">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="px-3 py-2">{pick(r, 'name') || '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{pick(r, 'phone')}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.utm?.source || '-'}</td>
                  <td className="px-3 py-2">
                    <Badge variant={r.outcome === 'accepted' ? 'default' : 'outline'}>{t(`outcome.${r.outcome}`)}</Badge>
                    {r.qualified === false ? <span className="ml-1 text-xs text-muted-foreground">{t('notQualified')}</span> : null}
                    {r.outcome === 'accepted' && Object.values(r.processing?.steps ?? {}).some((s) => s.ok === false) ? (
                      <span className="ml-1 text-xs text-amber-600">{t('needsAttention')}</span>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{pick(selected, 'name') || pick(selected, 'phone')}</SheetTitle>
                <SheetDescription>{new Date(selected.created_at).toLocaleString()}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-8">
                <dl className="space-y-2 text-sm">
                  {Object.entries(selected.answers ?? {}).map(([id, a]) => (
                    <div key={id}>
                      <dt className="text-xs text-muted-foreground">{a.label}</dt>
                      <dd className="break-words">{Array.isArray(a.value) ? a.value.join(', ') : String(a.value)}</dd>
                    </div>
                  ))}
                </dl>
                <div className="text-xs text-muted-foreground">
                  {t('score')}: {selected.score}
                  {selected.utm?.source ? ` · ${selected.utm.source}` : ''}
                  {selected.utm?.campaign ? ` / ${selected.utm.campaign}` : ''}
                  {selected.country ? ` · ${selected.country}` : ''}
                  {selected.is_repeat ? ` · ${t('repeat')}` : ''}
                </div>
                {failed.length > 0 && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                    <div className="font-medium text-amber-700">{t('failedSteps')}</div>
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {failed.map(([name, s]) => (
                        <li key={name}>
                          {name}: {s.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {selected.contact_id ? (
                    <Button variant="outline" size="sm" render={<a href={`/contacts?open=${selected.contact_id}`} />}>
                      {t('openContact')}
                    </Button>
                  ) : null}
                  {selected.outcome === 'held' && (
                    <Button size="sm" disabled={!canManage || busy} onClick={() => void act('release')}>
                      {t('release')}
                    </Button>
                  )}
                  {failed.length > 0 && selected.outcome === 'accepted' && (
                    <Button size="sm" disabled={!canManage || busy} onClick={() => void act('retry')}>
                      {t('retry')}
                    </Button>
                  )}
                  {selected.outcome === 'accepted' || selected.outcome === 'held' ? (
                    <>
                      <Button variant="outline" size="sm" disabled={!canManage || busy} onClick={() => void act('spam')}>
                        {t('spam')}
                      </Button>
                      {selected.contact_id ? (
                        <Button variant="outline" size="sm" disabled={!canManage || busy} onClick={() => void act('spam', true)}>
                          {t('spamBlock')}
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                  <Button variant="destructive" size="sm" disabled={!canDelete || busy} onClick={() => void remove()}>
                    {t('delete')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Leads per day as plain SVG bars (no chart library). Hover a bar for the day's numbers. */
function DailyBars({ daily }: { daily: Stats['daily'] }) {
  if (daily.length === 0) return null;
  const W = 600;
  const H = 90;
  const max = Math.max(1, ...daily.map((d) => d.submissions));
  const step = W / daily.length;
  const bar = Math.max(2, step * 0.7);
  return (
    <svg viewBox={`0 0 ${W} ${H + 4}`} className="h-24 w-full" role="img" aria-label="Leads per day" preserveAspectRatio="none">
      <line x1="0" y1={H} x2={W} y2={H} className="stroke-border" strokeWidth="1" />
      {daily.map((d, i) => {
        const h = d.submissions === 0 ? 1 : Math.max(3, (d.submissions / max) * (H - 6));
        return (
          <rect key={d.day} x={i * step + (step - bar) / 2} y={H - h} width={bar} height={h} rx="1.5" className={d.submissions === 0 ? 'fill-muted' : 'fill-primary'}>
            <title>{`${d.day}: ${d.submissions}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
