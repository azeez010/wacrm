import type { PipelineKind, StageOutcome } from '@/types';

/**
 * Pipeline kinds (migration 110): 'sales' pipelines hold deals,
 * 'support' pipelines hold tickets. Both live in the same tables; a
 * stage with an `outcome` is a FINAL stage, and moving a card there
 * sets deals.status to that outcome (DB trigger).
 *
 * Single source for default stages (dashboard UI, API v1, MCP).
 */

export const PIPELINE_KINDS: readonly PipelineKind[] = ['sales', 'support'];

export function isPipelineKind(v: unknown): v is PipelineKind {
  return v === 'sales' || v === 'support';
}

export function isStageOutcome(v: unknown): v is StageOutcome {
  return v === 'won' || v === 'lost';
}

/** Rows read before migration 110 have no kind. */
export function pipelineKind(p: { kind?: PipelineKind | null } | null | undefined): PipelineKind {
  return p?.kind === 'support' ? 'support' : 'sales';
}

export interface DefaultStage {
  /** i18n key under Pipelines.defaultStages */
  key: string;
  /** English name, used by the API/MCP and as a fallback */
  name: string;
  color: string;
  outcome: StageOutcome | null;
}

export const DEFAULT_STAGES_BY_KIND: Record<PipelineKind, readonly DefaultStage[]> = {
  sales: [
    { key: 'newLead', name: 'New lead', color: '#3b82f6', outcome: null },
    { key: 'qualified', name: 'Qualified', color: '#06b6d4', outcome: null },
    { key: 'proposalSent', name: 'Proposal', color: '#f59e0b', outcome: null },
    { key: 'negotiation', name: 'Negotiation', color: '#8b5cf6', outcome: null },
    { key: 'won', name: 'Won', color: '#22c55e', outcome: 'won' },
    { key: 'lost', name: 'Lost', color: '#ef4444', outcome: 'lost' },
  ],
  support: [
    { key: 'ticketNew', name: 'New', color: '#3b82f6', outcome: null },
    { key: 'inProgress', name: 'In progress', color: '#f59e0b', outcome: null },
    { key: 'waitingOnCustomer', name: 'Waiting on customer', color: '#8b5cf6', outcome: null },
    { key: 'resolved', name: 'Resolved', color: '#22c55e', outcome: 'won' },
    { key: 'closed', name: 'Closed', color: '#64748b', outcome: 'lost' },
  ],
};

interface OutcomeStage {
  id: string;
  position: number;
  outcome?: StageOutcome | null;
}

export function isFinalStage(stage: { outcome?: StageOutcome | null } | null | undefined): boolean {
  return stage?.outcome === 'won' || stage?.outcome === 'lost';
}

/** First final stage with this outcome, by position. */
export function firstFinalStage<T extends OutcomeStage>(
  stages: readonly T[],
  outcome: StageOutcome,
): T | undefined {
  return [...stages]
    .filter((s) => s.outcome === outcome)
    .sort((a, b) => a.position - b.position)[0];
}

/**
 * Win probability for a stage (weighted pipeline value):
 * - a 'won' final stage is 100%, a 'lost' one 0%;
 * - normal stages interpolate 10% → 90% by order among normal stages.
 * Pipelines with no final stage keep the old rule: the last stage
 * counts as won (100%) and the others interpolate 10% → 90%.
 */
export function stageProbability<T extends OutcomeStage>(
  stages: readonly T[],
  stageId: string,
): number {
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const target = sorted.find((s) => s.id === stageId);
  if (!target) return 0;
  if (target.outcome === 'won') return 1;
  if (target.outcome === 'lost') return 0;

  const hasFinal = sorted.some((s) => isFinalStage(s));
  if (!hasFinal) {
    const n = sorted.length;
    if (n <= 1) return 1;
    const index = sorted.findIndex((s) => s.id === stageId);
    if (index === n - 1) return 1;
    return interpolate(index, n - 1);
  }
  const normal = sorted.filter((s) => !isFinalStage(s));
  return interpolate(normal.findIndex((s) => s.id === stageId), normal.length);
}

/** 10% → 90% across `slots` positions. */
function interpolate(index: number, slots: number): number {
  if (slots <= 1) return 0.1;
  const t = index / (slots - 1);
  return 0.1 + t * (0.9 - 0.1);
}
