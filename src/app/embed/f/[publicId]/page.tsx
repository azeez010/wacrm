import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { ClosedNotice } from '@/components/public-form/closed-notice';
import { PreviewBridge } from '@/components/public-form/preview-bridge';
import { PublicForm } from '@/components/public-form/public-form';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { buildPublicConfig, loadFormByPublicId } from '@/lib/forms/public-config';
import { openState } from '@/lib/forms/submit';
import { pageCss } from '@/lib/forms/theme';
import { parseFormSettings } from '@/lib/forms/types';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Chrome-free version for iframes and the support-button panel. With ?preview=1
 * it renders an empty shell that waits for the editor to post the draft config,
 * so an unsaved or unpublished form never leaks anything from here.
 */
export default async function EmbeddedFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { publicId } = await params;
  const { preview } = await searchParams;
  if (preview === '1') {
    return (
      <>
        <style>{pageCss('auto')}</style>
        <PreviewBridge />
      </>
    );
  }
  const db = supabaseAdmin();
  const form = await loadFormByPublicId(db, publicId);
  if (!form) notFound();
  const settings = parseFormSettings(form.settings);
  const state = openState(form, settings, new Date());
  const detected = (await headers()).get('cf-ipcountry');
  return (
    <>
      <style>{pageCss(settings.theme)}</style>
      {state.open ? (
        <PublicForm config={await buildPublicConfig(db, form)} detectedCountry={detected} embedded />
      ) : state.reason === 'not_found' ? (
        notFound()
      ) : (
        <ClosedNotice reason={state.reason} message={settings.rules.closedMessage} lang={settings.language} />
      )}
    </>
  );
}
