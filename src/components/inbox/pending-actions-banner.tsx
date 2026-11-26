"use client";

// Inbox: actions the AI asked to take in this conversation that wait for a teammate (Settings → Integrations,
// "Allow without approval" off). Approve runs it and the AI tells the customer the outcome; Reject runs nothing.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, ShieldAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";

interface PendingCall {
  id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  expires_at: string | null;
  created_at: string;
}

function describeArgs(args: Record<string, unknown>): string {
  return Object.entries(args ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ")
    .slice(0, 300);
}

export function PendingActionsBanner({ conversationId, refreshKey }: { conversationId: string; refreshKey?: unknown }) {
  const t = useTranslations("Inbox.pendingActions");
  const [calls, setCalls] = useState<PendingCall[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/integrations/activity?status=pending_approval&conversation_id=${encodeURIComponent(conversationId)}`, { cache: "no-store" });
      if (!res.ok) return setCalls([]);
      const j = (await res.json()) as { calls?: PendingCall[] };
      const now = Date.now();
      setCalls((j.calls ?? []).filter((c) => !c.expires_at || Date.parse(c.expires_at) > now));
    } catch {
      setCalls([]);
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const decide = async (call: PendingCall, decision: "approve" | "reject") => {
    setBusy(call.id);
    try {
      const res = await fetch(`/api/ai/tool-calls/${call.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const j = (await res.json().catch(() => ({}))) as { status?: string; error?: string; followUpSent?: boolean };
      if (!res.ok) {
        toast.error(j.error ?? t("failed"));
      } else if (j.status === "rejected") {
        toast.success(t("rejected"));
      } else if (j.status === "error") {
        toast.error(t("ranWithError"));
      } else {
        toast.success(j.followUpSent ? t("approvedSent") : t("approved"));
      }
    } catch {
      toast.error(t("failed"));
    } finally {
      setBusy(null);
      void load();
    }
  };

  if (calls.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-900 dark:bg-amber-950/30">
      {calls.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center gap-3">
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-foreground">{t("title", { tool: c.tool_name })}</p>
            {describeArgs(c.arguments) ? <p className="truncate text-xs text-muted-foreground">{describeArgs(c.arguments)}</p> : null}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void decide(c, "reject")}>
              <X className="mr-1 h-3.5 w-3.5" />
              {t("reject")}
            </Button>
            <Button size="sm" disabled={busy !== null} onClick={() => void decide(c, "approve")}>
              {busy === c.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
              {t("approve")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
