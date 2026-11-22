'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, ChevronDown, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { buildSetup, CLIENTS, type SetupClient } from '@/lib/api-keys/setup';
import { cn } from '@/lib/utils';

export function CopyBlock({ label, value }: { label: string; value: string }) {
  const t = useTranslations('Settings.apiKeys');
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t('copyFailed'));
    }
  }
  const short = value.length < 60 && !value.includes('\n');
  return (
    <div className="space-y-1">
      <span className="text-foreground text-xs font-medium">{label}</span>
      <div className="bg-muted flex items-start gap-2 rounded-lg p-2.5">
        {short ? (
          <code className="text-foreground min-w-0 flex-1 break-all text-xs leading-relaxed">{value}</code>
        ) : (
          <pre className="text-foreground min-w-0 flex-1 overflow-x-auto text-xs leading-relaxed">{value}</pre>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={copy} className="shrink-0">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? t('copied') : t('copy')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The default is a single URL to paste. Claude Code, Claude Desktop and the REST API
 * (which need commands or files) sit behind one small link.
 */
export function ConnectInstructions({ keyValue }: { keyValue: string | null }) {
  const t = useTranslations('Settings.apiKeys');
  const [more, setMore] = useState(false);
  const [client, setClient] = useState<SetupClient>('claudecode');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = buildSetup(origin, keyValue, 'url')[0];
  const others = CLIENTS.filter((c) => c !== 'url');

  return (
    <div className="space-y-3">
      <CopyBlock label={t('block.connectUrl')} value={url.value} />
      <p className="text-muted-foreground text-xs">{t('urlNote')}</p>

      <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs underline-offset-2 hover:underline">
        <ChevronDown className={cn('size-3.5 transition-transform', more && 'rotate-180')} />
        {t('moreClients')}
      </button>
      {more ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5" role="tablist">
            {others.map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={client === c}
                onClick={() => setClient(c)}
                className={cn('rounded-full border px-3 py-1 text-xs', client === c ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted')}
              >
                {t(`client.${c}`)}
              </button>
            ))}
          </div>
          {buildSetup(origin, keyValue, client).map((b, i) => (
            <CopyBlock key={`${client}-${i}`} label={t(`block.${b.label}`)} value={b.value} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
