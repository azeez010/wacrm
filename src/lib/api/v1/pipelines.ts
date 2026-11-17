export const DEAL_SELECT =
  'id, pipeline_id, stage_id, contact_id, conversation_id, title, value, currency, notes, expected_close_date, status, created_at, updated_at';

export const DEFAULT_STAGES = ['New lead', 'Qualified', 'Proposal', 'Negotiation', 'Won'];

const PALETTE = ['#3b82f6', '#06b6d4', '#f59e0b', '#8b5cf6', '#22c55e', '#ef4444', '#ec4899', '#64748b'];

export interface StageInput {
  id?: string;
  name: string;
  color: string;
}

/**
 * Accept stages as plain names or `{ id?, name, color? }`. Returns the
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
    out.push({
      id: typeof obj.id === 'string' ? obj.id : undefined,
      name,
      color,
    });
  }
  return out;
}
