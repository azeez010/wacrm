import { stringsFor } from '@/lib/forms/public-strings';

export function ClosedNotice({ reason, message, lang }: { reason: 'closed' | 'unavailable'; message?: string; lang?: string }) {
  const t = stringsFor(lang);
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 text-center text-gray-800 shadow-sm">
      {message || (reason === 'closed' ? t.closed : t.unavailable)}
    </div>
  );
}
