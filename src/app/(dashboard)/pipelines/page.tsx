"use client";

import { useUrlAction } from "@/hooks/use-url-action";
import { Suspense, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Pipeline, PipelineKind, PipelineStage, Deal } from "@/types";
import { DEFAULT_STAGES_BY_KIND, pipelineKind } from "@/lib/pipelines/kinds";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { DealForm } from "@/components/pipelines/deal-form";
import { PipelineAnalytics } from "@/components/pipelines/pipeline-analytics";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitBranch, Plus, ChevronDown, Settings, LifeBuoy, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { GatedButton } from "@/components/ui/gated-button";
import { useTranslations } from "next-intl";

// Pipeline creation is admin-class (settings-tier write under
// the new RLS); deal creation is operational and only requires
// agent+. The two CTAs gate on different `useCan` capabilities,
// not on different copy.

// Default stages per pipeline kind come from src/lib/pipelines/kinds.ts;
// names are message keys under `Pipelines.page.defaultStages` so the
// seeded stages come out in the UI language.

// `useSearchParams` needs a Suspense boundary (see settings/page.tsx).
export default function PipelinesPage() {
  return (
    <Suspense fallback={null}>
      <PipelinesPageInner />
    </Suspense>
  );
}

function PipelinesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("Pipelines.page");
  const tGate = useTranslations("GatedButton");
  const supabase = createClient();
  const canEditSettings = useCan("edit-settings");
  const canCreateDeals = useCan("send-messages");
  const { accountId } = useAuth();
  // Sales (deals) or Support (tickets); kept in the URL (?kind=support).
  const kind: PipelineKind = searchParams.get("kind") === "support" ? "support" : "sales";
  const setKind = useCallback(
    (next: PipelineKind) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "support") params.set("kind", "support");
      else params.delete("kind");
      const qs = params.toString();
      router.replace(qs ? `/pipelines?${qs}` : "/pipelines");
    },
    [router, searchParams],
  );

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [newPipelineKind, setNewPipelineKind] = useState<PipelineKind>("sales");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal form state is lifted here so both the top-bar "Add Deal" and
  // the per-column "+" trigger the same Sheet.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .order("created_at");
    if (error) {
      console.error("Failed to load pipelines:", error.message);
      return [];
    }
    return data ?? [];
  }, [supabase]);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("position");
      return data ?? [];
    },
    [supabase],
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("deals")
        .select("*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*)")
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false });
      return (data ?? []) as Deal[];
    },
    [supabase],
  );

  const defaultStagesPayload = useCallback(
    (pipelineId: string, k: PipelineKind) =>
      DEFAULT_STAGES_BY_KIND[k].map((s, position) => ({
        pipeline_id: pipelineId,
        name: t(`defaultStages.${s.key}`),
        color: s.color,
        outcome: s.outcome,
        position,
      })),
    [t],
  );

  const seedDefaultPipeline = useCallback(async (): Promise<Pipeline | null> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return null;
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) return null;

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name: t("defaultPipelineName"), kind: "sales" })
      .select()
      .single();

    if (error || !pipeline) {
      console.error("Failed to seed pipeline:", error?.message);
      return null;
    }

    await supabase.from("pipeline_stages").insert(defaultStagesPayload(pipeline.id, "sales"));

    return pipeline as Pipeline;
  }, [supabase, accountId, t, defaultStagesPayload]);

  // Initial load + seed-if-empty
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let list = await loadPipelines();

      if (list.length === 0 && accountId && !seedAttempted.current) {
        seedAttempted.current = true;
        const seeded = await seedDefaultPipeline();
        if (seeded) list = await loadPipelines();
      }

      if (cancelled) return;
      setPipelines(list);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPipelines, seedDefaultPipeline, accountId]);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    if (!selectedPipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStages([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId),
      ]);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals]);

  // Pipelines of the current tab; the selection always stays inside it.
  const visiblePipelines = useMemo(
    () => pipelines.filter((p) => pipelineKind(p) === kind),
    [pipelines, kind],
  );
  const firstVisibleId = visiblePipelines[0]?.id ?? "";
  const selectionValid = visiblePipelines.some((p) => p.id === selectedPipelineId);
  // A just-created pipeline (possibly of the other kind) wins once it
  // shows up in the visible list.
  const pendingSelectRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    const pending = pendingSelectRef.current;
    if (pending && visiblePipelines.some((p) => p.id === pending)) {
      pendingSelectRef.current = null;
      setSelectedPipelineId(pending);
      return;
    }
    if (selectionValid) return;
    setSelectedPipelineId(firstVisibleId);
  }, [loading, selectionValid, firstVisibleId, visiblePipelines]);

  const refreshPipelines = useCallback(async () => {
    setPipelines(await loadPipelines());
  }, [loadPipelines]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setDeals(await loadDeals(selectedPipelineId));
  }, [loadDeals, selectedPipelineId]);

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      // Optimistic update - board already animated; just persist.
      // Mirror the DB trigger (migration 110): a final stage sets the
      // status to its outcome; leaving a final stage reopens the card.
      setDeals((prev) =>
        prev.map((d) => {
          if (d.id !== dealId) return d;
          const to = stages.find((s) => s.id === newStageId);
          const from = stages.find((s) => s.id === d.stage_id);
          const status = to?.outcome ? to.outcome : from?.outcome ? "open" : d.status;
          return { ...d, stage_id: newStageId, status };
        }),
      );
      const { error } = await supabase
        .from("deals")
        .update({ stage_id: newStageId })
        .eq("id", dealId);
      if (error) {
        toast.error(t("toastFailedMoveDeal"));
        refreshDeals();
      }
    },
    [supabase, refreshDeals, t, stages],
  );

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? "");
      setDealFormOpen(true);
    },
    [stages],
  );

  // Dashboard "New deal" links here with ?new=1: once the board has loaded,
  // open the deal form, then drop the param so a refresh doesn't reopen it.
  const wantsNew = searchParams.get("new") === "1";
  useEffect(() => {
    if (!wantsNew || loading || !canCreateDeals || stages.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    handleAddDeal();
    router.replace("/pipelines");
  }, [wantsNew, loading, canCreateDeals, stages, handleAddDeal, router]);

  // Command palette "New pipeline" links here with ?newPipeline=1.
  const openNewPipeline = useCallback(() => {
    setNewPipelineKind(kind);
    setNewPipelineOpen(true);
  }, [kind]);
  useUrlAction("newPipeline", openNewPipeline, !loading && canEditSettings);

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setCreating(false);
      return;
    }
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) {
      toast.error(t("toastNotLinkedToAccount"));
      setCreating(false);
      return;
    }

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name, kind: newPipelineKind })
      .select()
      .single();

    if (error || !pipeline) {
      toast.error(t("toastFailedCreatePipeline"));
      setCreating(false);
      return;
    }

    await supabase
      .from("pipeline_stages")
      .insert(defaultStagesPayload(pipeline.id, newPipelineKind));

    setNewPipelineName("");
    setNewPipelineOpen(false);
    pendingSelectRef.current = pipeline.id;
    await refreshPipelines();
    if (newPipelineKind !== kind) setKind(newPipelineKind);
    setCreating(false);
    toast.success(t("toastPipelineCreated"));
  }

  const selectedPipeline = visiblePipelines.find((p) => p.id === selectedPipelineId);
  const isSupport = kind === "support";

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl<PipelineKind>
            value={kind}
            onChange={setKind}
            aria-label={t("kindLabel")}
            noTruncate
            className="w-auto"
            options={[
              { value: "sales", label: t("kindSales"), icon: <TrendingUp className="size-3.5" /> },
              { value: "support", label: t("kindSupport"), icon: <LifeBuoy className="size-3.5" /> },
            ]}
          />
          {/* Pipeline selector dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors data-[popup-open]:bg-muted"
            >
              <GitBranch className="h-4 w-4 text-primary" />
              <span className="font-semibold">
                {selectedPipeline?.name ?? t("selectPipeline")}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-64 border-border bg-popover text-popover-foreground"
            >
              {visiblePipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  {t("noPipelinesYet")}
                </DropdownMenuItem>
              )}
              {visiblePipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={
                    p.id === selectedPipelineId
                      ? "text-primary"
                      : "text-popover-foreground"
                  }
                >
                  <GitBranch className="mr-2 h-3.5 w-3.5" />
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-border" />
              {selectedPipeline && (
                <DropdownMenuItem
                  onClick={() => setSettingsOpen(true)}
                  className="text-popover-foreground"
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  {t("managePipelines")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          <GatedButton
            variant="outline"
            canAct={canEditSettings}
            gateReason={tGate("reasons.createPipelines")}
            onClick={openNewPipeline}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("addPipeline")}
          </GatedButton>
          <GatedButton
            canAct={canCreateDeals}
            gateReason={tGate("reasons.createDeals")}
            disabled={!selectedPipelineId || stages.length === 0}
            onClick={() => handleAddDeal()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {isSupport ? t("addTicket") : t("addDeal")}
          </GatedButton>
        </div>
      </div>

      {/* Board */}
      {visiblePipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
          <GitBranch className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">
            {isSupport ? t("noSupportPipelinesYet") : t("noPipelinesYet")}
          </h3>
          <p className="mt-2 max-w-md text-center text-sm text-muted-foreground">
            {isSupport ? t("createSupportToStart") : t("createToStartTracking")}
          </p>
          <GatedButton
            canAct={canEditSettings}
            gateReason={tGate("reasons.createPipelines")}
            onClick={openNewPipeline}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("createPipeline")}
          </GatedButton>
        </div>
      ) : (
        <>
          <PipelineAnalytics stages={stages} deals={deals} kind={kind} />
          <PipelineBoard
            kind={kind}
            stages={stages}
            deals={deals}
            onDealMoved={handleDealMoved}
            onAddDeal={handleAddDeal}
            onEditDeal={handleEditDeal}
          />
        </>
      )}

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="sm:max-w-sm bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("newPipeline")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-muted-foreground">{t("kindLabel")}</Label>
            <SegmentedControl<PipelineKind>
              value={newPipelineKind}
              onChange={setNewPipelineKind}
              aria-label={t("kindLabel")}
              options={[
                { value: "sales", label: t("kindSales"), icon: <TrendingUp className="size-3.5" /> },
                { value: "support", label: t("kindSupport"), icon: <LifeBuoy className="size-3.5" /> },
              ]}
            />
            <Label className="pt-2 text-muted-foreground">{t("pipelineName")}</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder={
                newPipelineKind === "support"
                  ? t("supportPipelineNamePlaceholder")
                  : t("pipelineNamePlaceholder")
              }
              className="bg-muted border-border text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePipeline();
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {newPipelineKind === "support"
                ? t("defaultSupportStagesDesc")
                : t("defaultStagesDesc")}
            </p>
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? t("creating") : t("createPipelineBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            openNewPipeline();
          }}
        />
      )}

      {/* Deal Form (Sheet) */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        kind={kind}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
      />
    </div>
  );
}
