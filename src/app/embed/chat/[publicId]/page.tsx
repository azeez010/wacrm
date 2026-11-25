import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { PublicChat } from '@/components/public-chat/public-chat';
import { ClosedNotice } from '@/components/public-form/closed-notice';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { isLiveChatForm } from '@/lib/chat/http';
import { buildChatStatus } from '@/lib/chat/status';
import { buildPublicConfig, loadFormByPublicId } from '@/lib/forms/public-config';
import { openState } from '@/lib/forms/submit';
import { pageCss } from '@/lib/forms/theme';
import { parseFormSettings } from '@/lib/forms/types';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The live-chat panel of a support button, loaded in an iframe on the customer's site. */
export default async function EmbeddedChatPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const db = supabaseAdmin();
  const form = await loadFormByPublicId(db, publicId);
  if (!form || !isLiveChatForm(form)) notFound();
  const settings = parseFormSettings(form.settings);
  const state = openState(form, settings, new Date());
  const detected = (await headers()).get('cf-ipcountry');
  if (!state.open) {
    if (state.reason === 'not_found') notFound();
    return (
      <>
        <style>{pageCss(settings.theme)}</style>
        <ClosedNotice reason={state.reason} message={settings.rules.closedMessage} lang={settings.language} />
      </>
    );
  }
  // Everything the first paint needs, fetched in parallel, so the widget never waits on a second round trip.
  const [config, initialStatus] = await Promise.all([buildPublicConfig(db, form), buildChatStatus(db, form, settings)]);
  return (
    <>
      <style>{pageCss(settings.theme)}</style>
      <PublicChat config={config} initialStatus={initialStatus} detectedCountry={detected} />
    </>
  );
}
