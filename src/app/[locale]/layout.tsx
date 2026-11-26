import { LandingAnnouncement } from "@/components/announcements/landing-announcement";

// Only wraps the localized landing page: shows the admin console's landing announcement (if any) above it.
export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <>
      <LandingAnnouncement locale={locale} />
      {children}
    </>
  );
}
