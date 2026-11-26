"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { parseAnnouncements, type Announcement } from "@/lib/announcements";
import { AnnouncementBars } from "./announcement-bar";

/** In-app announcements for the signed-in business. Fails silent: any error shows nothing. Re-checks every 10 minutes. */
export function DashboardAnnouncements() {
  const { accountId } = useAuth();
  const locale = useLocale();
  const [items, setItems] = useState<Announcement[]>([]);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const supabase = createClient();
    const load = async () => {
      try {
        const { data, error } = await supabase.rpc("active_announcements", { p_account: accountId });
        if (!cancelled && !error) setItems(parseAnnouncements(data));
      } catch {
        /* fail silent */
      }
    };
    void load();
    const timer = window.setInterval(load, 600_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [accountId]);

  return <AnnouncementBars items={items} locale={locale} className="mb-4" />;
}
