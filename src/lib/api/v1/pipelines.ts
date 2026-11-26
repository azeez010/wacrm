import { DEFAULT_STAGES_BY_KIND, isStageOutcome } from '@/lib/pipelines/kinds';
import type { PipelineKind, StageOutcome } from '@/types';

export const DEAL_SELECT =
  'id, pipeline_id, stage_id, contact_id, conversation_id, title, value, currency, notes, expected_close_date, status, priority, closed_at, created_at, updated_at';

export const PIPELINE_SELECT = 'id, name, kind, created_at';
export const STAGE_SELECT = 'id, name, color, position, outcome';

/** Default stages for a new pipeline of this kind (final stages included). */
export function defaultStagesFor(kind: PipelineKind): StageInput[] {
  return DEFAULT_STAGES_BY_KIND[kind].map((s) => ({
    name: s.name,
    color: s.color,
    outcome: s.outcome,
  }));
}

const PALETTE = ['#3b82f6', '#06b6d4', '#f59e0b', '#8b5cf6', '#22c55e', '#ef4444', '#ec4899', '#64748b'];

export interface StageInput {
  id?: string;
  name: string;
  color: string;
  /** null = normal stage; 'won' | 'lost' = final stage. */
  outcome: StageOutcome | null;
}

/**
 * Accept stages as plain names or `{ id?, name, color?, outcome? }`. Returns the
 * normalized list, or an error STRING describing what's wrong.
 */
export function normalizeStages(input: unknown): StageInput[] | string {
  if (!Array.isArray(input)) return "'stages' must be an array";
  if (input.length === 0) return "'stages' needs at least one stage";
  if (input.length > 20) return "'stages' allows at most 20 stages";
  const out: StageInput[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    const obj = typeof raw === 'string' ? { name: raw } : (raw as Record<string, unknown>);
    const name = typeof obj?.name === 'string' ? obj.name.trim() : '';
    if (!name || name.length > 60) return `stage ${i + 1}: 'name' is required (max 60 chars)`;
    const color =
      typeof obj.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(obj.color)
        ? obj.color
        : PALETTE[i % PALETTE.length];
    const rawOutcome = obj.outcome ?? null;
    if (rawOutcome !== null && !isStageOutcome(rawOutcome)) {
      return `stage ${i + 1}: 'outcome' must be "won", "lost" or null`;
    }
    out.push({
      id: typeof obj.id === 'string' ? obj.id : undefined,
      name,
      color,
      outcome: rawOutcome,
    });
  }
  return out;
}

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

/**
 * Ticket priority from a request body. `undefined` = not given,
 * `null` = clear it, a string error = invalid.
 */
export function parsePriority(
  v: unknown,
): (typeof PRIORITIES)[number] | null | undefined | { error: string } {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v)) {
    return v as (typeof PRIORITIES)[number];
  }
  return { error: "'priority' must be low, normal, high, urgent or null" };
}
