"use client";

import { useMemo } from "react";
import type { Deal, PipelineKind, PipelineStage } from "@/types";
import { stageProbability } from "@/lib/pipelines/kinds";
import {
  DollarSign,
  TrendingUp,
  Target,
  BarChart3,
  Trophy,
  XCircle,
  Info,
  Inbox,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";

interface PipelineAnalyticsProps {
  kind?: PipelineKind;
  stages: PipelineStage[];
  deals: Deal[];
}

export function PipelineAnalytics({ kind = "sales", stages, deals }: PipelineAnalyticsProps) {
  if (kind === "support") return <SupportAnalytics deals={deals} />;
  return <SalesAnalytics stages={stages} deals={deals} />;
}

/** Closed (won/lost) since this month started; closed_at when known. */
function closedThisMonth(d: Deal, monthStart: Date): boolean {
  const ts = d.closed_at ?? d.updated_at ?? d.created_at;
  return ts ? new Date(ts) >= monthStart : false;
}

function SupportAnalytics({ deals }: { deals: Deal[] }) {
  const t = useTranslations("Pipelines.analytics");
  const stats = useMemo(() => {
    const open = deals.filter((d) => (d.status ?? "open") === "open");
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const resolvedThisMonth = deals.filter(
      (d) => d.status === "won" && closedThisMonth(d, monthStart),
    ).length;
    const closedNotResolved = deals.filter(
      (d) => d.status === "lost" && closedThisMonth(d, monthStart),
    ).length;
    const durations = deals
      .filter((d) => d.status === "won" && d.closed_at)
      .map((d) => new Date(d.closed_at as string).getTime() - new Date(d.created_at).getTime())
      .filter((ms) => ms >= 0);
    const avgMs = durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null;
    const urgent = open.filter((d) => d.priority === "urgent" || d.priority === "high").length;
    return { open: open.length, resolvedThisMonth, closedNotResolved, avgMs, urgent };
  }, [deals]);

  const avgLabel =
    stats.avgMs === null
      ? "—"
      : stats.avgMs < 3_600_000
        ? t("minutes", { n: Math.max(1, Math.round(stats.avgMs / 60_000)) })
        : stats.avgMs < 86_400_000
          ? t("hours", { n: Math.round(stats.avgMs / 3_600_000) })
          : t("days", { n: Math.round((stats.avgMs / 86_400_000) * 10) / 10 });

  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card/60 p-4 sm:grid-cols-3 xl:grid-cols-5">
        <Metric
          icon={<Inbox className="h-4 w-4 text-muted-foreground" />}
          label={t("openTickets")}
          value={String(stats.open)}
          tooltip={t("openTicketsTooltip")}
          t={t}
        />
        <Metric
          icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
          label={t("highPriority")}
          value={String(stats.urgent)}
          tooltip={t("highPriorityTooltip")}
          t={t}
        />
        <Metric
          icon={<CheckCircle2 className="h-4 w-4 text-primary" />}
          label={t("resolvedThisMonth")}
          value={String(stats.resolvedThisMonth)}
          tooltip={t("resolvedThisMonthTooltip")}
          t={t}
        />
        <Metric
          icon={<XCircle className="h-4 w-4 text-muted-foreground" />}
          label={t("closedThisMonth")}
          value={String(stats.closedNotResolved)}
          tooltip={t("closedThisMonthTooltip")}
          t={t}
        />
        <Metric
          icon={<Clock className="h-4 w-4 text-blue-400" />}
          label={t("avgResolveTime")}
          value={avgLabel}
          tooltip={t("avgResolveTimeTooltip")}
          t={t}
        />
      </div>
    </TooltipProvider>
  );
}

function SalesAnalytics({ stages, deals }: { stages: PipelineStage[]; deals: Deal[] }) {
  const t = useTranslations("Pipelines.analytics");
  const { defaultCurrency } = useAuth();
  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );

  const stats = useMemo(() => {
    const active = deals.filter((d) => d.status !== "lost");
    const openDeals = active.filter((d) => d.status !== "won");

    const totalCount = active.length;
    const totalValue = active.reduce((sum, d) => sum + Number(d.value || 0), 0);
    const avgValue = totalCount > 0 ? totalValue / totalCount : 0;

    const weightedValue = openDeals.reduce((sum, d) => {
      if (!sortedStages.some((s) => s.id === d.stage_id)) return sum;
      return sum + Number(d.value || 0) * stageProbability(sortedStages, d.stage_id);
    }, 0);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonth = (d: Deal) => closedThisMonth(d, monthStart);
    const wonThisMonth = deals.filter(
      (d) => d.status === "won" && thisMonth(d),
    ).length;
    const lostThisMonth = deals.filter(
      (d) => d.status === "lost" && thisMonth(d),
    ).length;

    return {
      totalCount,
      totalValue,
      avgValue,
      weightedValue,
      wonThisMonth,
      lostThisMonth,
    };
  }, [deals, sortedStages]);

  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card/60 p-4 sm:grid-cols-3 xl:grid-cols-6">
        <Metric
          icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
          label={t("totalDeals")}
          value={String(stats.totalCount)}
          tooltip={t("totalDealsTooltip")}
          t={t}
        />
        <Metric
          icon={<DollarSign className="h-4 w-4 text-primary" />}
          label={t("pipelineValue")}
          value={formatCurrency(stats.totalValue, defaultCurrency)}
          tooltip={t("pipelineValueTooltip")}
          t={t}
        />
        <Metric
          icon={<Target className="h-4 w-4 text-blue-400" />}
          label={t("avgDealSize")}
          value={formatCurrency(stats.avgValue, defaultCurrency)}
          tooltip={t("avgDealSizeTooltip")}
          t={t}
        />
        <Metric
          icon={<TrendingUp className="h-4 w-4 text-purple-400" />}
          label={t("weightedValue")}
          value={formatCurrency(stats.weightedValue, defaultCurrency)}
          tooltip={t("weightedValueTooltip")}
          t={t}
        />
        <Metric
          icon={<Trophy className="h-4 w-4 text-primary" />}
          label={t("wonThisMonth")}
          value={String(stats.wonThisMonth)}
          tooltip={t("wonThisMonthTooltip")}
          t={t}
        />
        <Metric
          icon={<XCircle className="h-4 w-4 text-red-400" />}
          label={t("lostThisMonth")}
          value={String(stats.lostThisMonth)}
          tooltip={t("lostThisMonthTooltip")}
          t={t}
        />
      </div>
    </TooltipProvider>
  );
}

function Metric({
  icon,
  label,
  value,
  tooltip,
  t,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tooltip: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{label}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={t("howCalculated", { label })}
                className="ml-auto text-muted-foreground hover:text-foreground focus:outline-none"
              />
            }
          >
            <Info className="h-3 w-3" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-left">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="mt-1 text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}
