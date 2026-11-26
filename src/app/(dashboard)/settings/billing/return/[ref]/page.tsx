'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatPlanPrice } from '@/lib/billing/format';

type Status = { status: string; planId: string; amount: number | null; currency: string | null };
const DONE = ['succeeded', 'failed', 'expired', 'canceled'];

// The payment provider sends the customer back here (/settings/billing/return/<reference>). We ask the server, which verifies
// with the provider and activates the plan when paid; we poll a few times while it's pending.
function Return() {
  const t = useTranslations('Settings.billing.pay');
  const locale = useLocale();
  const ref = useParams<{ ref: string }>().ref ?? '';
  const [s, setS] = useState<Status | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!ref) return;
    let live = true;
    let tries = 0;
    const tick = async () => {
      const res = await fetch(`/api/account/billing/checkout/${encodeURIComponent(ref)}`, { cache: 'no-store' }).catch(() => null);
      if (!live) return;
      if (!res || res.status === 404) return setMissing(true);
      const body = (await res.json().catch(() => null)) as Status | null;
      if (body) setS(body);
      tries += 1;
      if (body && !DONE.includes(body.status) && tries < 20) setTimeout(() => void tick(), 3000);
    };
    void tick();
    return () => {
      live = false;
    };
  }, [ref]);

  const done = s?.status === 'succeeded';
  const failed = s && ['failed', 'expired', 'canceled'].includes(s.status);
  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardContent className="space-y-4 p-6 text-center">
          {done ? <CheckCircle2 className="text-primary mx-auto size-10" /> : failed || missing ? <XCircle className="mx-auto size-10 text-red-500" /> : <Loader2 className="text-muted-foreground mx-auto size-10 animate-spin" />}
          <p className="text-sm">
            {!ref || missing ? t('returnFailed')
              : done ? t('returnSucceeded', { amount: s.amount != null && s.currency ? formatPlanPrice(Number(s.amount), s.currency, locale) : '' })
              : failed ? t('returnFailed')
              : s ? t('returnPending') : t('returnChecking')}
          </p>
          <Link href="/settings?tab=billing" className={buttonVariants({ variant: done ? 'default' : 'outline' })}>{t('returnBack')}</Link>
        </CardContent>
      </Card>
    </div>
  );
}

export default function BillingReturnPage() {
  return (
    <Suspense>
      <Return />
    </Suspense>
  );
}
