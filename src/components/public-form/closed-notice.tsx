import { stringsFor } from '@/lib/forms/public-strings';

/** Shown instead of a form that is closed or unavailable. Colours come from the form theme variables. */
export function ClosedNotice({ reason, message, lang }: { reason: 'closed' | 'unavailable'; message?: string; lang?: string }) {
  const t = stringsFor(lang);
  return (
    <div
      className="mx-auto w-full max-w-md rounded-2xl border border-[color:var(--og-border)] bg-[var(--og-card)] p-8 text-center shadow-sm"
      style={{ color: 'var(--og-fg)' }}
    >
      {message || (reason === 'closed' ? t.closed : t.unavailable)}
    </div>
  );
}
