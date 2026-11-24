'use client';

import { useEffect, useState } from 'react';

import type { PublicFormConfig } from '@/lib/forms/public-config';
import { pageCss } from '@/lib/forms/theme';
import type { PreviewEdit } from '@/lib/forms/preview-edit';
import { PublicChat } from '@/components/public-chat/public-chat';
import { PublicForm } from './public-form';

/**
 * The panel of the editor's real preview. It renders whatever draft config the editor
 * (or the preview-mode embed script relaying for it) posts, so every edit shows
 * immediately and nothing is fetched from the server. Same-origin messages only.
 */
export function PreviewBridge() {
  const [config, setConfig] = useState<PublicFormConfig | null>(null);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { source?: string; config?: PublicFormConfig } | null;
      if (d?.source === 'ogadesk-preview' && d.config) setConfig(d.config);
    };
    window.addEventListener('message', onMessage);
    // Tell whoever embeds us that we are ready for the config.
    window.parent.postMessage({ source: 'ogadesk-preview-ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const onEdit = (edit: PreviewEdit) => window.parent.postMessage({ source: 'ogadesk-preview-edit', edit }, window.location.origin);
  if (!config) return null;
  if (config.kind === 'support' && config.widget?.mode === 'live_chat') {
    return (
      <>
        <style>{pageCss(config.theme)}</style>
        <PublicChat key={config.publicId} config={config} preview />
      </>
    );
  }
  return (
    <>
      <style>{pageCss(config.theme)}</style>
      <PublicForm key={config.publicId} config={config} embedded={config.kind === 'support'} preview onEdit={onEdit} fullPage={config.kind === 'lead' && !!config.backgroundImage} />
    </>
  );
}
