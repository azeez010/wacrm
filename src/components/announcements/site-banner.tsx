import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { BLOG_API_URL } from "@/lib/blog/api";
import { forCountry, parseAnnouncements } from "@/lib/announcements";
import { SiteBannerBar } from "./site-banner-bar";

/**
 * The public-site announcement bar(s), written in the admin console. Shown at the top of every public page
 * (landing, blog, help, changelog, marketing, partners, legal) but never on auth or dashboard pages.
 * Edge-cached for 60 s; filtered per visitor by Cloudflare's country header. Any failure renders nothing.
 */
export async function SiteBanner({ locale }: { locale?: string }) {
  let items = [] as ReturnType<typeof parseAnnouncements>;
  try {
    const init: RequestInit & { cf?: { cacheTtl: number; cacheEverything: boolean } } = {
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(2500), cf: { cacheTtl: 60, cacheEverything: true },
    };
    const res = await fetch(`${BLOG_API_URL}/announcements/landing`, init);
    if (res.ok) items = parseAnnouncements(((await res.json()) as { data?: unknown }).data);
  } catch {
    return null;
  }
  const country = (await headers()).get("cf-ipcountry");
  items = forCountry(items, country);
  if (items.length === 0) return null;
  return <SiteBannerBar items={items} locale={locale ?? (await getLocale())} />;
}
