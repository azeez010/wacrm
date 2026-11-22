'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import type { Contact } from '@/types';

interface Row {
  id: string;
  created_at: string;
  outcome: string;
  qualified: boolean | null;
  forms: { name: string } | { name: string }[] | null;
}

/** Where this contact came from, and the forms they filled in. Read-only. */
export function ContactSourceCard({ contact }: { contact: Contact }) {
  const t = useTranslations('Contacts.detailView.source');
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await createClient()
        .from('form_submissions')
        .select('id, created_at, outcome, qualified, forms(name)')
        .eq('contact_id', contact.id)
        .in('outcome', ['accepted', 'held'])
        .order('created_at', { ascending: false })
        .limit(10);
      if (!cancelled) setRows((data as unknown as Row[] | null) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [contact.id]);

  const origin = [contact.utm_source, contact.utm_medium, contact.utm_campaign].filter(Boolean).join(' / ');
  if (!contact.lead_source && !origin && rows.length === 0) return null;

  return (
    <div className="mt-4 space-y-2 border-t border-border pt-3 text-xs">
      <div className="font-medium text-foreground">{t('title')}</div>
      {contact.lead_source ? (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t('leadSource')}</span>
          <span className="text-right text-foreground">{contact.lead_source}</span>
        </div>
      ) : null}
      {origin ? (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">UTM</span>
          <span className="text-right text-foreground">{origin}</span>
        </div>
      ) : null}
      {contact.opt_in_at ? (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t('optIn')}</span>
          <span className="text-right text-foreground">{new Date(contact.opt_in_at).toLocaleDateString()}</span>
        </div>
      ) : null}
      {rows.length > 0 && (
        <div className="space-y-1">
          <div className="text-muted-foreground">{t('submissions')}</div>
          {rows.map((r) => {
            const f = Array.isArray(r.forms) ? r.forms[0] : r.forms;
            return (
              <div key={r.id} className="flex justify-between gap-2">
                <span className="truncate text-foreground">{f?.name ?? '-'}</span>
                <span className="shrink-0 text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString()}
                  {r.qualified === false ? ` · ${t('notQualified')}` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
