'use client';

import { createContext, useContext, useRef } from 'react';

import type { PreviewEdit } from '@/lib/forms/preview-edit';

/** Present only in the editor preview: text becomes click-to-edit. Never set on real pages. */
export const EditContext = createContext<((edit: PreviewEdit) => void) | null>(null);

type Target =
  | { kind: 'setting'; key: 'title' | 'description' | 'buttonText' }
  | { kind: 'field'; fieldId: string; key: 'label' | 'help' | 'text' | 'consentText' };

/** Plain text on a real page; click-to-edit text in the editor preview (Enter or click away saves, Esc cancels). */
export function Editable({ target, value, multiline }: { target: Target; value: string; multiline?: boolean }) {
  const onEdit = useContext(EditContext);
  const ref = useRef<HTMLSpanElement>(null);
  if (!onEdit) return <>{value}</>;
  const commit = () => {
    const next = (ref.current?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (next !== value) onEdit({ ...target, value: next } as PreviewEdit);
  };
  return (
    <span
      ref={ref}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      title=""
      data-og-edit=""
      className="cursor-text rounded-sm outline-dashed outline-1 outline-offset-2 outline-transparent hover:outline-[color:var(--og-muted)] focus:outline-[color:var(--og-muted)]"
      onClick={(e) => e.preventDefault()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          if (ref.current) ref.current.textContent = value;
          ref.current?.blur();
        } else if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
    >
      {value}
    </span>
  );
}
