"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PauseCircle } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * Covers the workspace when the platform admin has suspended this business. The message is written by the
 * admin (a default is supplied by the database), so no new translation keys are needed. Server routes refuse
 * the same account independently (see lib/auth/suspension.ts); this is the part the customer sees.
 *
 * Fails open: any error leaves the app usable. Re-checks every 2 minutes and when the tab regains focus, so a
 * reactivation clears it without a reload.
 */
export function SuspensionGate() {
  const { accountId, signOut } = useAuth();
  const t = useTranslations("Sidebar");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const supabase = createClient();
    const check = async () => {
      try {
        const { data, error } = await supabase.rpc("account_suspension_gate", { p_account: accountId });
        if (cancelled || error || !data || typeof data !== "object") return;
        const raw = data as { suspended?: unknown; message?: unknown };
        setMessage(raw.suspended === true && typeof raw.message === "string" ? raw.message : null);
      } catch {
        /* fail open */
      }
    };
    void check();
    const timer = window.setInterval(check, 120_000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [accountId]);

  if (!message) return null;
  return (
    <div role="alertdialog" aria-modal="true" aria-live="assertive" className="fixed inset-0 z-[100] flex items-center justify-center bg-background p-6">
      <div className="max-w-md text-center">
        <PauseCircle className="mx-auto mb-4 size-12 text-muted-foreground" aria-hidden />
        <p className="text-lg font-medium">{message}</p>
        <Button className="mt-6" variant="outline" onClick={() => void signOut()}>
          {t("menuSignOut")}
        </Button>
      </div>
    </div>
  );
}
