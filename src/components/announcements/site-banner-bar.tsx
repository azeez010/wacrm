"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { countdownParts, pickText, readDismissed, STYLE_CLASS, visibleAnnouncements, writeDismissed, type Announcement } from "@/lib/announcements";

const pad = (n: number) => String(n).padStart(2, "0");

/** Live "01d 05h 12m 09s"; renders nothing until mounted (no server/client clock mismatch) and nothing once it ends. */
function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null;
  const p = countdownParts(new Date(to).getTime() - now);
  if (!p) return null;
  return (
    <time dateTime={to} aria-live="off" className="inline-flex items-center gap-1 rounded-md bg-black/20 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums tracking-tight sm:text-sm">
      {p.days > 0 && <span>{pad(p.days)}d</span>}
      <span>{pad(p.hours)}h</span>
      <span>{pad(p.minutes)}m</span>
      <span>{pad(p.seconds)}s</span>
    </time>
  );
}

/** Full-width bars at the very top of public pages (Serlzo/DMly style). Text is admin-written per locale. */
export function SiteBannerBar({ items, locale }: { items: Announcement[]; locale: string }) {
  const t = useTranslations("UiPrimitives");
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  useEffect(() => setDismissed(readDismissed(typeof window === "undefined" ? undefined : window.localStorage)), []);
  const shown = (dismissed === null ? items.filter((a) => !a.dismissible) : visibleAnnouncements(items, dismissed)).slice(0, 2);
  if (shown.length === 0) return null;

  const close = (id: string) => {
    const next = [...(dismissed ?? []), id];
    setDismissed(next);
    writeDismissed(window.localStorage, next);
  };

  return (
    <div className="w-full">
      {shown.map((a) => {
        const c = STYLE_CLASS[a.style];
        const title = pickText(a.title, locale);
        const body = pickText(a.body, locale);
        const badge = pickText(a.badge, locale);
        const label = pickText(a.linkLabel, locale);
        const external = a.linkUrl?.startsWith("https://");
        return (
          <div key={a.id} role={a.style === "critical" ? "alert" : "region"} aria-label={title} className={cn("relative w-full", c.bar)}>
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-10 py-2.5 text-center text-sm sm:py-3">
              {badge && <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ring-1", c.badge)}>{badge}</span>}
              <p className="leading-snug">
                <span className="font-semibold">{title}</span>
                {body ? <span className="opacity-90"> {body}</span> : null}
              </p>
              {a.countdownTo && <Countdown to={a.countdownTo} />}
              {a.linkUrl && (
                <Link href={a.linkUrl} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className={cn("inline-flex items-center gap-1 rounded-full px-3.5 py-1 text-xs font-semibold shadow-sm transition-colors sm:text-sm", c.button)}>
                  {label || "Learn more"}
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              )}
            </div>
            {a.dismissible && (
              <button type="button" onClick={() => close(a.id)} aria-label={t("close")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 opacity-75 hover:bg-black/10 hover:opacity-100">
                <X className="size-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
