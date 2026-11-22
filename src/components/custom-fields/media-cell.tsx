'use client';

import { FileText } from 'lucide-react';
import { kindFromMime, parseMediaValue } from '@/lib/custom-fields/media';

/** Compact table cell for a media value: thumbnail or icon, plus the name as a link. */
export function MediaCell({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">-</span>;
  const parsed = parseMediaValue(value);
  if (!parsed.ok) return <span className="text-muted-foreground">-</span>;
  const m = parsed.value;
  return (
    <a
      href={m.url}
      target="_blank"
      rel="noopener noreferrer"
      title={m.name}
      onClick={(e) => e.stopPropagation()}
      className="flex min-w-0 items-center gap-1.5 hover:underline"
    >
      {kindFromMime(m.mime) === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.url} alt="" loading="lazy" className="size-6 shrink-0 rounded object-cover" />
      ) : (
        <FileText className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{m.name}</span>
    </a>
  );
}
