'use client';

import { formatFieldValue } from '@/lib/custom-fields/format';
import { ExpandableText } from '@/components/ui/expandable-text';

type LinkType = 'url' | 'email' | 'phone';

/** Table cell for url / email / phone values: a link that does the obvious thing. */
export function LinkCell({ type, value }: { type: LinkType; value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">-</span>;
  const href = type === 'url' ? value : type === 'email' ? `mailto:${value}` : `tel:${value}`;
  const text = type === 'url' ? formatFieldValue({ field_type: 'url' }, value) : value;
  const link = (
    <a
      href={href}
      target={type === 'url' ? '_blank' : undefined}
      rel={type === 'url' ? 'noopener noreferrer' : undefined}
      onClick={(e) => e.stopPropagation()}
      className="text-foreground hover:underline"
    >
      {text}
    </a>
  );
  return (
    <ExpandableText text={text} className="max-w-[130px]">
      {link}
    </ExpandableText>
  );
}

export const isLinkType = (t: string): t is LinkType => t === 'url' || t === 'email' || t === 'phone';
