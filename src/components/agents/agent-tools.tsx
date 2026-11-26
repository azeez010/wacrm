'use client';

// Which integrations (Settings → Integrations) this agent's AI may use. All connected ones by default.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { AgentDto } from '@/lib/ai/agents-client';

interface IntegrationLite {
  id: string;
  name: string;
  kind: string;
  status: string;
  tools: { enabled: boolean }[];
}

export function AgentTools({ agent, canEdit, onSaved }: { agent: AgentDto; canEdit: boolean; onSaved: (a: AgentDto) => void }) {
  const t = useTranslations('Agents.tools');
  const [items, setItems] = useState<IntegrationLite[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<'all' | 'selected'>(agent.tool_integrations ? 'selected' : 'all');
  const [selected, setSelected] = useState<Set<string>>(new Set(agent.tool_integrations ?? []));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/integrations', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { integrations?: IntegrationLite[]; usage?: { enabled: boolean } }) => {
        setItems(j.integrations ?? []);
        setEnabled(j.usage?.enabled !== false);
      })
      .catch(() => setItems([]));
  }, []);

  const save = async () => {
    setSaving(true);
    const tool_integrations = mode === 'all' ? null : [...selected];
    try {
      const res = await fetch(`/api/ai/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_integrations }),
      });
      if (!res.ok) throw new Error();
      toast.success(t('saved'));
      onSaved({ ...agent, tool_integrations });
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!items ? (
          <Loader2 className="text-primary size-5 animate-spin" />
        ) : !enabled ? (
          <p className="text-muted-foreground text-sm">{t('notInPlan')}</p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t('none')}{' '}
            <a href="/settings?tab=integrations" className="text-primary underline-offset-4 hover:underline">
              {t('connect')}
            </a>
          </p>
        ) : (
          <>
            <SegmentedControl
              value={mode}
              onChange={setMode}
              disabled={!canEdit}
              options={[
                { value: 'all', label: t('all') },
                { value: 'selected', label: t('selected') },
              ]}
              className="w-fit"
            />
            {mode === 'selected' ? (
              <ul className="space-y-2">
                {items.map((i) => (
                  <li key={i.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selected.has(i.id)}
                        disabled={!canEdit}
                        onCheckedChange={(v) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (v === true) n.add(i.id);
                            else n.delete(i.id);
                            return n;
                          })
                        }
                      />
                      <span>{i.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {t('toolCount', { count: i.tools.filter((x) => x.enabled).length })}
                        {i.status !== 'connected' ? ` · ${t('paused')}` : ''}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-xs">{t('allHint', { count: items.filter((i) => i.status === 'connected').length })}</p>
            )}
            <p className="text-muted-foreground text-xs">{t('safetyHint')}</p>
            {canEdit ? (
              <div className="flex justify-end">
                <Button onClick={() => void save()} disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('save')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
