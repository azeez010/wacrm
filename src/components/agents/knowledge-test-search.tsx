'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FlaskConical, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fetchAgents, type AgentDto } from '@/lib/ai/agents-client';
import { matchLabel } from './ai-playground';

interface Hit {
  title: string | null;
  snippet: string;
  score: number;
  matched_by: 'semantic' | 'keyword' | 'both';
}

// Base UI Select can't use an empty value: "the whole library" sentinel.
const WHOLE_LIBRARY = '__all__';

/**
 * "Test a question": runs knowledge retrieval only (no AI call, no
 * credits) and shows what an agent would be given, with scores. The way
 * to check a new source is found, and to see why an agent handed off.
 */
export function KnowledgeTestSearch() {
  const t = useTranslations('Agents.library');
  const tp = useTranslations('Agents.playground');
  const { accountId } = useAuth();
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [agentId, setAgentId] = useState(WHOLE_LIBRARY);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ hits: Hit[]; semantic: boolean } | null>(null);

  useEffect(() => {
    if (accountId) void fetchAgents(accountId).then(setAgents);
  }, [accountId]);

  const run = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/ai/knowledge/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, ...(agentId !== WHOLE_LIBRARY ? { agent_id: agentId } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return void toast.error(data.error ?? t('testFailed'));
      setResult({ hits: data.hits ?? [], semantic: Boolean(data.semantic) });
    } catch {
      toast.error(t('testFailed'));
    } finally {
      setBusy(false);
    }
  };

  const agentLabel = agentId === WHOLE_LIBRARY ? t('testWholeLibrary') : (agents.find((a) => a.id === agentId)?.name ?? '');

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <FlaskConical className="h-4 w-4 text-primary" /> {t('testTitle')}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{t('testDesc')}</p>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('testPlaceholder')}
          className="min-w-[220px] flex-1"
          maxLength={1000}
        />
        {agents.length > 0 && (
          <Select value={agentId} onValueChange={(v) => v && setAgentId(v)}>
            <SelectTrigger className="w-48">
              <SelectValue>{agentLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={WHOLE_LIBRARY}>{t('testWholeLibrary')}</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {t('testAsAgent', { name: a.name })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button type="submit" size="sm" className="h-9" disabled={busy || !query.trim()}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
          {t('testRun')}
        </Button>
      </form>

      {result && (
        <div className="mt-3 space-y-2">
          {!result.semantic && <p className="text-xs text-muted-foreground">{t('testKeywordOnly')}</p>}
          {result.hits.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              {t('testNoHits')}
            </p>
          ) : (
            <ol className="space-y-1.5">
              {result.hits.map((h, i) => (
                <li key={i} className="rounded-md border border-border p-2 text-xs">
                  <p className="flex items-center justify-between gap-2 font-medium text-foreground">
                    <span className="truncate">
                      {i + 1}. {h.title || tp('untitled')}
                    </span>
                    <span className="shrink-0 font-normal text-muted-foreground">
                      {matchLabel(h.matched_by, tp)} · {h.score.toFixed(2)}
                    </span>
                  </p>
                  <p className="mt-0.5 line-clamp-3 text-muted-foreground">{h.snippet}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
