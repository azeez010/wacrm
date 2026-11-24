'use client';

import { Suspense, useMemo, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { SettingsRail } from '@/components/settings/settings-rail';
import { SettingsOverview } from '@/components/settings/settings-overview';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { LanguagePanel } from '@/components/settings/language-panel';
import { LOCALE_NAMES, isLocale } from '@/i18n/locales';
import { WhatsAppEmbeddedSignup } from '@/components/settings/whatsapp-embedded-signup';
import { TemplateManager } from '@/components/settings/template-manager';
import { TimezonePanel } from '@/components/settings/timezone-panel';
import { TablesPanel } from '@/components/settings/tables-panel';
import { QuickRepliesManager } from '@/components/settings/quick-replies-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { InboxSettings } from '@/components/settings/inbox-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { ApiKeysPanel } from '@/components/settings/api-keys-panel';
import { WebhooksPanel } from '@/components/settings/webhooks-panel';
import { BillingPanel } from '@/components/settings/billing-panel';
import {
  resolveSection,
  type SettingsSection,
} from '@/components/settings/settings-sections';

// `useSearchParams` opts this page out of static prerendering unless it
// sits under a Suspense boundary. Without one, the production build hits
// the "missing Suspense with CSR bailout" error and the whole page bails
// to client-side rendering - shipping a settings screen whose rail never
// wires up its click handlers. You land on the section the URL carried
// (the account-menu Settings link points at `?tab=whatsapp`) and can't
// navigate away. Mirror the login/signup split: a thin wrapper supplies
// the boundary; the inner component reads the query string.
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { defaultCurrency, accountTimezone } = useAuth();
  const { mode } = useTheme();
  const t = useTranslations('Settings');
  const rawLocale = useLocale();

  // The URL (`?tab=`) is the single source of truth for the active
  // section - deep-linkable, and it keeps the existing links in the
  // app sidebar/header working. Legacy tab values (tags, custom-fields)
  // resolve onto their new home; unknown/empty → the Overview landing.
  const section = resolveSection(searchParams.get('tab'));

  const go = (next: SettingsSection) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  // Cheap, fetch-free rail hints. The Overview landing carries the
  // full live status/counts; the rail just surfaces the two that are
  // already in context.
  const hints: Partial<Record<SettingsSection, ReactNode>> = useMemo(
    () => ({
      appearance: mode.charAt(0).toUpperCase() + mode.slice(1),
      language: isLocale(rawLocale) ? LOCALE_NAMES[rawLocale] : undefined,
      timezone: accountTimezone,
      deals: defaultCurrency,
    }),
    [mode, defaultCurrency, rawLocale, accountTimezone]
  );

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} />,
    profile: <ProfileForm />,
    billing: <BillingPanel />,
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    language: <LanguagePanel />,
    timezone: <TimezonePanel />,
    whatsapp: (
      <WhatsAppEmbeddedSignup onConnected={() => window.location.reload()} />
    ),
    templates: <TemplateManager />,
    'quick-replies': <QuickRepliesManager />,
    fields: <FieldsAndTagsPanel />,
    tables: <TablesPanel />,
    inbox: <InboxSettings />,
    deals: <DealsSettings />,
    members: <MembersTab />,
    api: <ApiKeysPanel />,
    webhooks: <WebhooksPanel />,
  };

  return (
    <div>
      <p className="text-muted-foreground text-sm">{t('pageDesc')}</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <SettingsRail active={section} onSelect={go} hints={hints} />
        <div className="min-w-0">{panel[section]}</div>
      </div>
    </div>
  );
}
