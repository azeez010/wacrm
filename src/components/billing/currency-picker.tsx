'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';

import { Flag } from '@/components/flag';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { refreshMoney } from '@/hooks/use-money';
import { CURRENCY_FLAG, isSupportedCurrency } from '@/lib/currency/supported';
import { cn } from '@/lib/utils';

type Currency = { current: string; options: string[] };

function CurrencyFlag({ code }: { code: string }) {
  const iso = isSupportedCurrency(code) ? CURRENCY_FLAG[code] : null;
  return iso ? <Flag iso={iso} /> : null;
}

/**
 * The display-currency picker for dialogs: same cookie as the pricing page's switcher, but no page reload.
 * Every price shown with useMoney() updates; `onChange` lets the caller refetch real quotes (checkout).
 */
export function CurrencyPicker({ onChange, className }: { onChange?: (currency: string) => void; className?: string }) {
  const t = useTranslations('Settings.billing.picker');
  const [fx, setFx] = useState<Currency | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch('/api/currency')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { enabled?: boolean; current?: string; options?: string[] } | null) => {
        if (live && d?.enabled !== false && d?.current && Array.isArray(d.options)) setFx({ current: d.current, options: d.options });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!fx || fx.options.length < 2) return null;

  async function choose(code: string) {
    if (!fx || code === fx.current || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/currency', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currency: code }) });
      if (!res.ok) return;
      setFx({ ...fx, current: code });
      refreshMoney();
      onChange?.(code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('currency')}
        disabled={busy}
        className={cn('inline-flex h-9 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium hover:bg-muted/60', className)}
      >
        <CurrencyFlag code={fx.current} />
        {fx.current}
        <ChevronDown className="text-muted-foreground size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        {fx.options.map((c) => (
          <DropdownMenuItem key={c} onClick={() => void choose(c)}>
            <CurrencyFlag code={c} />
            {c}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
