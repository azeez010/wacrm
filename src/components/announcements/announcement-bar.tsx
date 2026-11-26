"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { pickText, readDismissed, SEVERITY_CLASS, visibleAnnouncements, writeDismissed, type Announcement } from "@/lib/announcements";

/** Renders admin announcements as stacked bars. Text is admin-written per locale; only the close label is translated. */
export function AnnouncementBars({ items, locale, className }: { items: Announcement[]; locale: string; className?: string }) {
  const t = useTranslations("UiPrimitives");
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  useEffect(() => setDismissed(readDismissed(typeof window === "undefined" ? undefined : window.localStorage)), []);
  // Until storage is read, show only the ones that cannot be dismissed (avoids a flash of an already-closed banner).
  const shown = dismissed === null ? items.filter((a) => !a.dismissible) : visibleAnnouncements(items, dismissed);
  if (shown.length === 0) return null;

  const close = (id: string) => {
    const next = [...(dismissed ?? []), id];
    setDismissed(next);
    writeDismissed(window.localStorage, next);
  };

  return (
    <div className={cn("space-y-2", className)}>
      {shown.map((a) => {
        const title = pickText(a.title, locale);
        const body = pickText(a.body, locale);
        const label = pickText(a.linkLabel, locale);
        const external = a.linkUrl?.startsWith("https://");
        return (
          <div key={a.id} role={a.severity === "critical" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-md border px-4 py-2.5 text-sm", SEVERITY_CLASS[a.severity])}>
            <p className="flex-1">
              <span className="font-medium">{title}</span>
              {body ? <span className="opacity-90"> {body}</span> : null}
              {a.linkUrl ? (
                <>
                  {" "}
                  <Link href={a.linkUrl} className="font-medium underline underline-offset-2" {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                    {label || "→"}
                  </Link>
                </>
              ) : null}
            </p>
            {a.dismissible ? (
              <button type="button" onClick={() => close(a.id)} aria-label={t("close")} className="-mr-1 rounded p-1 opacity-70 hover:opacity-100">
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
