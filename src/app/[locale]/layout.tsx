import { SiteBanner } from "@/components/announcements/site-banner";

// Wraps the localized landing page: the admin console's website bar (if any) sits above it.
export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <>
      <SiteBanner locale={locale} />
      {children}
    </>
  );
}
