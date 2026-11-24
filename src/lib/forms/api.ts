import { parseFormStats } from './stats'
import type { FormRow } from './types'

type FormLike = Pick<FormRow, 'id' | 'public_id' | 'kind' | 'name' | 'status'> &
  Partial<Pick<FormRow, 'fields' | 'settings' | 'version'>> & { created_at?: string; updated_at?: string; stats_cache?: unknown }

/** The public API shape of a form. `full` adds the editable definition. */
export function serializeForm(f: FormLike, origin: string, full = false) {
  return {
    id: f.id,
    name: f.name,
    kind: f.kind,
    status: f.status,
    url: `${origin}/f/${f.public_id}`,
    embed_script: f.kind === 'support'
      ? `<script src="${origin}/embed.js" data-widget="${f.public_id}" async></script>`
      : `<div data-ogadesk-form="${f.public_id}"></div><script src="${origin}/embed.js" async></script>`,
    created_at: f.created_at,
    updated_at: f.updated_at,
    // Last 30 days, pre-computed and refreshed every few minutes. null until the first refresh.
    ...(f.stats_cache !== undefined ? { stats: parseFormStats(f.stats_cache) } : {}),
    ...(full ? { version: f.version, fields: f.fields, settings: f.settings } : {}),
  };
}
