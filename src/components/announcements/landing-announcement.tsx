import { BLOG_API_URL } from "@/lib/blog/api";
import { parseAnnouncements } from "@/lib/announcements";
import { AnnouncementBars } from "./announcement-bar";

/** The public-site banner, fetched from the admin API (edge-cached 60 s). Any failure (or a slow API) renders nothing. */
export async function LandingAnnouncement({ locale }: { locale: string }) {
  let items = [] as ReturnType<typeof parseAnnouncements>;
  try {
    // Edge-cached for 60 s on Cloudflare (same approach as the blog); the page itself is dynamic.
    const init: RequestInit & { cf?: { cacheTtl: number; cacheEverything: boolean } } = {
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(2500), cf: { cacheTtl: 60, cacheEverything: true },
    };
    const res = await fetch(`${BLOG_API_URL}/announcements/landing`, init);
    if (res.ok) items = parseAnnouncements(((await res.json()) as { data?: unknown }).data);
  } catch {
    return null;
  }
  if (items.length === 0) return null;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-3">
      <AnnouncementBars items={items} locale={locale} />
    </div>
  );
}
