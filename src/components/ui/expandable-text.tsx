'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { createExpandController } from '@/lib/expand-controller';

interface Props {
  /** Plain text (used to decide if the value is cut off, and shown in full when expanded). */
  text: string;
  /** Rich rendering (e.g. a link) used in both the cut and the expanded view. */
  children?: React.ReactNode;
  /** Fixed width of the cut view, e.g. "max-w-[130px]". */
  className?: string;
}

/**
 * A value cut to a fixed width. Rest the pointer on it and the full text
 * floats open (over the table, no layout shift); it stays about 5 seconds
 * after the pointer leaves, longer while you have text selected, so it can be
 * copied. Escape, a click elsewhere or scrolling closes it.
 */
export function ExpandableText({ text, children, className }: Props) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; minWidth: number } | null>(null);

  const controller = useMemo(
    () =>
      createExpandController({
        onChange: setOpen,
        hasSelection: () => {
          const sel = typeof window !== 'undefined' ? window.getSelection() : null;
          const panel = typeof document !== 'undefined' ? document.getElementById(panelId) : null;
          return !!sel && !sel.isCollapsed && !!panel && panel.contains(sel.anchorNode);
        },
      }),
    [panelId]
  );

  useEffect(() => () => controller.close(), [controller]);

  // Place the panel over the cell, kept inside the window.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    setPos({ left: r.left, top: r.top, minWidth: r.width });
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !pos || !panelRef.current) return;
    const p = panelRef.current.getBoundingClientRect();
    let left = pos.left;
    let top = pos.top;
    if (left + p.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - p.width - 8);
    if (top + p.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - p.height - 8);
    if (left !== pos.left || top !== pos.top) setPos({ ...pos, left, top });
  }, [open, pos]);

  // Close on Escape, scroll or a click elsewhere.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && controller.close();
    const onScroll = () => controller.close();
    const onDown = (e: PointerEvent) => {
      const el = e.target as Node;
      if (!panelRef.current?.contains(el) && !anchorRef.current?.contains(el)) controller.close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, controller]);

  const onEnter = useCallback(() => {
    const el = anchorRef.current;
    controller.enter(!!el && el.scrollWidth > el.clientWidth + 1);
  }, [controller]);

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={onEnter}
        onMouseLeave={() => controller.leave()}
        className={cn('block truncate', className)}
      >
        {children ?? text}
      </span>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="tooltip"
            onMouseEnter={() => controller.hold()}
            onMouseLeave={() => controller.leave()}
            style={{ position: 'fixed', left: pos.left, top: pos.top, minWidth: pos.minWidth, maxWidth: 448 }}
            className="z-[100] cursor-text select-text break-words rounded-md border border-border bg-popover px-2.5 py-1.5 text-sm text-popover-foreground shadow-lg"
          >
            {children ?? text}
          </div>,
          document.body
        )}
    </>
  );
}
