import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { ClosedNotice } from '@/components/public-form/closed-notice';
import { PublicForm } from '@/components/public-form/public-form';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { buildPublicConfig, loadFormByPublicId } from '@/lib/forms/public-config';
import { openState } from '@/lib/forms/submit';
import { themeVars } from '@/lib/forms/theme';
import { parseFormSettings } from '@/lib/forms/types';

// Public, anonymous lead form. Always rendered on request (config can change any
// time); the response is edge-cached for a few seconds by next.config headers.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ publicId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { publicId } = await params;
  const form = await loadFormByPublicId(supabaseAdmin(), publicId);
  if (!form) return { title: 'Form', robots: { index: false, follow: false } };
  const s = parseFormSettings(form.settings);
  const title = s.ogTitle || s.title || form.name;
  const description = s.ogDescription || s.description;
  return {
    title,
    description,
    robots: s.noindex === false ? undefined : { index: false, follow: false },
    openGraph: { title, description, images: s.ogImage ? [s.ogImage] : undefined },
  };
}

export default async function PublicFormPage({ params }: Props) {
  const { publicId } = await params;
  const db = supabaseAdmin();
  const form = await loadFormByPublicId(db, publicId);
  if (!form) notFound();
  const settings = parseFormSettings(form.settings);
  const state = openState(form, settings, new Date());
  if (!state.open) {
    if (state.reason === 'not_found') notFound();
    return (
      <main style={{ ...themeVars(settings.theme), color: 'var(--og-fg)' }} className="min-h-screen bg-[var(--og-page)] px-4 py-8 sm:py-14">
        <ClosedNotice reason={state.reason} message={settings.rules.closedMessage} lang={settings.language} />
      </main>
    );
  }
  const config = await buildPublicConfig(db, form);
  // Cloudflare tells us the visitor's country; used when the form's default country is "automatic".
  const detected = (await headers()).get('cf-ipcountry');
  return <PublicForm config={config} detectedCountry={detected} fullPage />;
}
