"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supportInfo } from "@/lib/support/session";

// Shown only to an OgaDesk admin who opened this business from the admin console. Staff-facing, so English only.
export function SupportSessionBanner() {
  const { user } = useAuth();
  const info = supportInfo(user);
  const [now, setNow] = useState(() => Date.now());
  const sessionId = info?.sessionId;
  const expiresAt = info?.expiresAt ?? 0;
  useEffect(() => {
    if (!sessionId) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sessionId]);
  useEffect(() => {
    if (sessionId && expiresAt <= now) window.location.assign("/api/support/end?reason=expired");
  }, [sessionId, expiresAt, now]);
  if (!info) return null;
  const left = Math.max(0, Math.floor((info.expiresAt - now) / 1000));
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <div role="status" className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm font-medium text-white ${info.readOnly ? "bg-sky-700" : "bg-amber-600"}`}>
      <span>
        Support session by {info.admin} · {info.readOnly ? "read-only, changes are blocked" : "changes allowed and recorded"} · ends in {mm}:{ss}
      </span>
      <form action="/api/support/end" method="post">
        <button type="submit" className="rounded bg-white/20 px-3 py-1 hover:bg-white/30">End session</button>
      </form>
    </div>
  );
}
