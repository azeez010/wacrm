import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ClosedNotice } from '@/components/public-form/closed-notice';
import { PublicForm } from '@/components/public-form/public-form';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { buildPublicConfig, loadFormByPublicId } from '@/lib/forms/public-config';
import { openState } from '@/lib/forms/submit';
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
      <Shell>
        <ClosedNotice reason={state.reason} message={settings.rules.closedMessage} lang={settings.language} />
      </Shell>
    );
  }
  const config = await buildPublicConfig(db, form);
  return (
    <Shell>
      <PublicForm config={config} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-gray-50 px-4 py-8 text-gray-900 sm:py-14">{children}</main>;
}
