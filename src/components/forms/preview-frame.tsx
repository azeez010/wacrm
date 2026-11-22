'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PublicFormConfig } from '@/lib/forms/public-config';
import { parsePreviewEdit, type PreviewEdit } from '@/lib/forms/preview-edit';

/**
 * The editor's REAL preview. A lead form is shown in an iframe of the actual embed page;
 * a support button is shown on a mock website that loads the actual /embed.js, so the
 * button, animation, teaser, panel and clicks behave exactly as on a customer's site.
 * The draft config is posted into the iframe on every edit (no save needed).
 */
export function PreviewFrame({
  kind,
  publicId,
  config,
  device,
  playTick,
  onEdit,
}: {
  kind: 'lead' | 'support';
  publicId: string;
  config: PublicFormConfig;
  device: 'desktop' | 'mobile';
  /** Increment to play the button sound in the preview. */
  playTick: number;
  /** The visitor-facing text was edited inside the preview. */
  onEdit?: (edit: PreviewEdit) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const latest = useRef(config);
  const onEditRef = useRef(onEdit);
  useEffect(() => {
    onEditRef.current = onEdit;
  }, [onEdit]);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  const post = useCallback((message: Record<string, unknown>) => {
    ref.current?.contentWindow?.postMessage(message, window.location.origin);
  }, []);

  useEffect(() => {
    latest.current = config;
    post({ source: 'ogadesk-preview', config });
  }, [config, post]);

  useEffect(() => {
    if (playTick > 0) post({ source: 'ogadesk-preview-play' });
  }, [playTick, post]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== ref.current?.contentWindow) return;
      const d = e.data as { source?: string; edit?: unknown } | null;
      if (d?.source === 'ogadesk-preview-edit') {
        const edit = parsePreviewEdit(d.edit);
        if (edit) onEditRef.current?.(edit);
        return;
      }
      if (d?.source === 'ogadesk-preview-ready' || d?.source === 'ogadesk-preview-host-ready') {
        post({ source: 'ogadesk-preview', config: latest.current });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [post]);

  const srcDoc = useMemo(() => {
    if (kind !== 'support' || !origin) return undefined;
    // A stand-in for the customer's website, with the real script on it.
    const bars = [70, 90, 55, 80, 40, 85, 65]
      .map((w) => `<div style="height:10px;width:${w}%;background:#d1d5db;border-radius:5px;margin:14px 0"></div>`)
      .join('');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px;background:#f3f4f6;font:14px system-ui,sans-serif"><div style="height:18px;width:40%;background:#9ca3af;border-radius:6px;margin-bottom:22px"></div>${bars}<script src="${origin}/embed.js" data-widget="${publicId}" data-preview="1"></script></body></html>`;
  }, [kind, origin, publicId]);

  if (!origin) return null;
  const width = device === 'mobile' ? 'max-w-[22rem]' : 'w-full';
  return (
    <iframe
      ref={ref}
      title=""
      aria-label="Live preview"
      {...(kind === 'support' ? { srcDoc } : { src: `${origin}/embed/f/${publicId}?preview=1` })}
      className={`mx-auto block h-[640px] w-full ${width} rounded-xl border border-border bg-background`}
    />
  );
}
