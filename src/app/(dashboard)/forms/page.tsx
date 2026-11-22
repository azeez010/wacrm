"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ClipboardList, Copy, Loader2, MessageCircle, MoreHorizontal, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GatedButton } from "@/components/ui/gated-button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/dashboard/empty-state";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { createClient } from "@/lib/supabase/client";
import { monthStartUtc } from "@/lib/billing/usage";
import { TEMPLATE_SLUGS } from "@/lib/forms/template-slugs";

interface FormListRow {
  id: string;
  public_id: string;
  kind: "lead" | "support";
  name: string;
  status: "draft" | "active" | "paused";
}

interface Usage {
  planName: string;
  forms: { used: number; limit: number | null };
  leads: { used: number; held: number; limit: number | null };
}

interface MonthRow {
  form_id: string;
  outcome: string;
  processing: { steps?: Record<string, { ok?: boolean }> } | null;
}

export default function FormsPage() {
  const t = useTranslations("Forms.list");
  const tGate = useTranslations("GatedButton");
  const router = useRouter();
  const { accountId } = useAuth();
  const canManage = useCan("manage-forms");
  const canDelete = useCan("delete-forms");
  const [forms, setForms] = useState<FormListRow[] | null>(null);
  const [month, setMonth] = useState<MonthRow[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const [f, m, u] = await Promise.all([
      supabase
        .from("forms")
        .select("id, public_id, kind, name, status")
        .eq("account_id", accountId)
        .is("archived_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("form_submissions")
        .select("form_id, outcome, processing")
        .eq("account_id", accountId)
        .eq("is_test", false)
        .gte("created_at", monthStartUtc().toISOString())
        .limit(5000),
      fetch("/api/forms/usage").then((r) => (r.ok ? (r.json() as Promise<Usage>) : null)).catch(() => null),
    ]);
    setForms((f.data as FormListRow[] | null) ?? []);
    setMonth((m.data as MonthRow[] | null) ?? []);
    setUsage(u);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const by = new Map<string, { leads: number; attention: number }>();
    for (const r of month) {
      const s = by.get(r.form_id) ?? { leads: 0, attention: 0 };
      if (r.outcome === "accepted" || r.outcome === "held") s.leads += 1;
      if (r.outcome === "accepted" && Object.values(r.processing?.steps ?? {}).some((x) => x.ok === false)) s.attention += 1;
      by.set(r.form_id, s);
    }
    return by;
  }, [month]);

  const linkFor = (f: FormListRow) => `${window.location.origin}/f/${f.public_id}`;

  async function duplicate(f: FormListRow) {
    const res = await fetch(`/api/forms/${f.id}/duplicate`, { method: "POST" });
    const json = (await res.json().catch(() => ({}))) as { form?: { id: string }; error?: string };
    if (!res.ok || !json.form) return toast.error(json.error ?? t("duplicateFailed"));
    router.push(`/forms/${json.form.id}`);
  }

  async function archive(f: FormListRow) {
    const res = await fetch(`/api/forms/${f.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? t("archiveFailed"));
    toast.success(t("archived"));
    void load();
  }

  if (forms === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const near = (u: number, l: number | null) => l !== null && l > 0 && u / l >= 0.8;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        <GatedButton canAct={canManage} gateReason={tGate("reasons.manageForms")} onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4" />
          {t("new")}
        </GatedButton>
      </div>

      {usage ? (
        <p className={`text-xs ${near(usage.forms.used, usage.forms.limit) || near(usage.leads.used, usage.leads.limit) ? "text-amber-600" : "text-muted-foreground"}`}>
          {t("usage", {
            forms: usage.forms.used,
            formsLimit: usage.forms.limit === null ? t("unlimited") : String(usage.forms.limit),
            leads: usage.leads.used,
            leadsLimit: usage.leads.limit === null ? t("unlimited") : String(usage.leads.limit),
          })}
          {usage.leads.held > 0 ? ` ${t("held", { count: usage.leads.held })}` : ""}
        </p>
      ) : null}

      {forms.length === 0 ? (
        <EmptyState title={t("emptyTitle")} hint={t("emptyHint")} icon={ClipboardList} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {forms.map((f) => {
            const s = stats.get(f.id) ?? { leads: 0, attention: 0 };
            return (
              <li key={f.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
                <button type="button" onClick={() => router.push(`/forms/${f.id}`)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {f.kind === "support" ? <MessageCircle className="size-4" /> : <ClipboardList className="size-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{f.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {f.kind === "support" ? t("kindSupport") : t("kindLead")} · {t("leadsMonth", { count: s.leads })}
                    </span>
                  </span>
                </button>
                {s.attention > 0 ? (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-600">
                    {t("attention", { count: s.attention })}
                  </Badge>
                ) : null}
                <Badge variant={f.status === "active" ? "default" : "outline"}>{t(`status.${f.status}`)}</Badge>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("copyLink")}
                  title={t("copyLink")}
                  onClick={async () => {
                    await navigator.clipboard.writeText(linkFor(f));
                    toast.success(t("copied"));
                  }}
                >
                  <Copy className="size-4" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("more")} />}>
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={!canManage} onClick={() => void duplicate(f)}>
                      {t("duplicate")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" disabled={!canDelete} onClick={() => void archive(f)}>
                      {t("archive")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}

      <NewFormDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(id) => router.push(`/forms/${id}`)} />
    </div>
  );
}

function NewFormDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const t = useTranslations("Forms.new");
  const ts = useTranslations("Forms.templates");
  const [kind, setKind] = useState<"lead" | "support" | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setKind(null);
      setName("");
    }
  }, [open]);

  async function create(template: string) {
    setBusy(true);
    const res = await fetch("/api/forms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template, name: name.trim() || undefined }),
    });
    const json = (await res.json().catch(() => ({}))) as { form?: { id: string }; error?: string };
    setBusy(false);
    if (!res.ok || !json.form) return toast.error(json.error ?? t("failed"));
    onOpenChange(false);
    onCreated(json.form.id);
  }

  const templates = TEMPLATE_SLUGS.filter((s) => (kind === "support" ? s === "support" : s !== "support"));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{kind ? t("pickTemplate") : t("title")}</DialogTitle>
          <DialogDescription>{kind ? t("nameHint") : t("question")}</DialogDescription>
        </DialogHeader>
        {!kind ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => setKind("lead")} className="rounded-xl border border-border p-4 text-left transition-colors hover:border-primary hover:bg-primary/5">
              <ClipboardList className="mb-2 size-5 text-primary" />
              <div className="text-sm font-medium">{t("leadTitle")}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t("leadHint")}</div>
            </button>
            <button type="button" onClick={() => setKind("support")} className="rounded-xl border border-border p-4 text-left transition-colors hover:border-primary hover:bg-primary/5">
              <MessageCircle className="mb-2 size-5 text-primary" />
              <div className="text-sm font-medium">{t("supportTitle")}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t("supportHint")}</div>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} maxLength={120} />
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => void create(s)}
                  className="rounded-lg border border-border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-60"
                >
                  <div className="text-sm font-medium">{ts(`${s}.name`)}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{ts(`${s}.description`)}</div>
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setKind(null)} disabled={busy}>
              {t("back")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
