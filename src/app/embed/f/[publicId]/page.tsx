import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ClosedNotice } from '@/components/public-form/closed-notice';
import { PublicForm } from '@/components/public-form/public-form';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { buildPublicConfig, loadFormByPublicId } from '@/lib/forms/public-config';
import { openState } from '@/lib/forms/submit';
import { parseFormSettings } from '@/lib/forms/types';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Chrome-free version for iframes and the support-button panel. */
export default async function EmbeddedFormPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const db = supabaseAdmin();
  const form = await loadFormByPublicId(db, publicId);
  if (!form) notFound();
  const settings = parseFormSettings(form.settings);
  const state = openState(form, settings, new Date());
  return (
    <>
      <style>{'html,body{background:transparent!important}'}</style>
      <div className="p-1 text-gray-900">
        {state.open ? (
          <PublicForm config={await buildPublicConfig(db, form)} embedded />
        ) : state.reason === 'not_found' ? (
          notFound()
        ) : (
          <ClosedNotice reason={state.reason} message={settings.rules.closedMessage} lang={settings.language} />
        )}
      </div>
    </>
  );
}
