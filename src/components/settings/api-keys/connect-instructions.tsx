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

function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-border rounded-lg border">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium">
        {title}
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? <div className="border-border border-t p-3">{children}</div> : null}
    </div>
  );
}

const CAPS = ['read', 'build', 'write', 'send', 'templates', 'broadcast'] as const;

/** Setup for one client at a time. `keyValue` null = show a placeholder instead of a key. */
export function ConnectInstructions({ keyValue }: { keyValue: string | null }) {
  const t = useTranslations('Settings.apiKeys');
  const [client, setClient] = useState<SetupClient>('claudeai');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const blocks = buildSetup(origin, keyValue, client);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <span className="text-muted-foreground text-xs">{t('connectTo')}</span>
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {CLIENTS.map((c) => (
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
        <p className="text-muted-foreground text-xs">{t(`clientHint.${client}`)}</p>
      </div>

      <div className="space-y-3">
        {blocks.map((b, i) => (
          <CopyBlock key={`${client}-${i}`} label={t(`block.${b.label}`)} value={b.value} />
        ))}
      </div>

      <Disclosure title={t('otherWays')}>
        <p className="text-muted-foreground text-xs">{t('otherWaysBody')}</p>
      </Disclosure>
      <Disclosure title={t('capsTitle')}>
        <ul className="space-y-2">
          {CAPS.map((c) => (
            <li key={c}>
              <p className="text-xs font-medium">{t(`caps.${c}.title`)}</p>
              <p className="text-muted-foreground text-xs">{t(`caps.${c}.examples`)}</p>
            </li>
          ))}
        </ul>
      </Disclosure>
    </div>
  );
}
