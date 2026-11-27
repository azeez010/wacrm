// Public API helpers for the AI agent routes (/api/v1/ai/*): one place that turns AI service results into the
// v1 envelope, with plain-English messages.
import { fail, ok } from './respond'
import type { Result } from '@/lib/ai/service'

const MESSAGES: Record<string, string> = {
  name_required: 'name is required',
  name_too_long: 'name is too long (max 80 characters)',
  prompt_too_long: 'system_prompt is too long (max 20000 characters)',
  knowledge_mode_invalid: "knowledge_mode must be 'all' or 'selected'",
  persona_too_long: 'A persona field is too long',
  handoff_not_member: 'handoff_agent_id must be a member of this workspace (see list_team_members)',
  agent_limit: 'This workspace already has the most AI agents allowed (20)',
  default_undeletable: 'The default agent cannot be deleted; make another agent the default first in the app',
  source_ids_required: 'source_ids must be an array of knowledge source ids',
  unknown_sources: 'One or more source_ids are not knowledge sources in this workspace',
  source_limit: 'The knowledge library is full; delete a source first',
  query_required: 'query is required',
  empty_update: 'Nothing to update',
  file_upload_only: 'Files are uploaded in the app (Settings > AI > Knowledge); use text, qa, url or website here',
  type_invalid: "type must be 'text', 'qa', 'url' or 'website'",
  content_required: 'content is required',
  content_too_long: 'content is too long',
  pairs_required: 'pairs must be a non-empty array of { question, answer }',
  url_invalid: 'url must be an http(s) address',
  not_found: 'Not found',
}

export function aiResult<T>(r: Result<T>, status = 200) {
  if (r.ok) return ok(r.data, status)
  if (r.status === 404) return fail('not_found', MESSAGES.not_found, 404)
  if (r.status === 400) return fail('bad_request', MESSAGES[r.code] ?? 'Invalid request', 400)
  return fail('internal', 'The AI change failed', 500)
}
