// ============================================================
// GET   /api/v1/conversations/{id} - read one conversation (scope: conversations:read)
// PATCH /api/v1/conversations/{id} - assign / close / reopen   (scope: conversations:write)
// Account-scoped: a foreign id → 404.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { isUuid } from '@/lib/api/v1/pagination';
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from '@/lib/inbox/conversations';
import { serializeConversation } from '@/lib/api/v1/conversations';
import type { Conversation } from '@/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Conversation not found', 404);

    const { data, error } = await ctx.supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/conversations] read error:', error);
      return fail('internal', 'Failed to read conversation', 500);
    }
    if (!data) return fail('not_found', 'Conversation not found', 404);

    return ok(serializeConversation(normalizeConversation(data as Conversation)));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

const STATUSES = ['open', 'pending', 'closed'] as const;

/** PATCH { status?: open|pending|closed, assigned_agent_id?: uuid | null } */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:write');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Conversation not found', 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const patch: Record<string, unknown> = {};
    if (body.status !== undefined) {
      if (typeof body.status !== 'string' || !(STATUSES as readonly string[]).includes(body.status)) {
        return fail('bad_request', "'status' must be open, pending or closed", 400);
      }
      patch.status = body.status;
    }
    if (body.assigned_agent_id !== undefined) {
      const agent = body.assigned_agent_id;
      if (agent !== null) {
        if (typeof agent !== 'string' || !isUuid(agent)) {
          return fail('bad_request', "'assigned_agent_id' must be a user id or null", 400);
        }
        // Only people who work in this account can be assigned (viewers can't handle chats).
        const { data: member } = await ctx.supabase
          .from('profiles')
          .select('user_id')
          .eq('user_id', agent)
          .eq('account_id', ctx.accountId)
          .in('account_role', ['owner', 'admin', 'agent'])
          .maybeSingle();
        if (!member) return fail('bad_request', 'That user is not a team member who can take conversations', 400);
      }
      patch.assigned_agent_id = agent;
    }
    if (Object.keys(patch).length === 0) {
      return fail('bad_request', "Send 'status' and/or 'assigned_agent_id'", 400);
    }

    const { data: updated, error } = await ctx.supabase
      .from('conversations')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[api/v1/conversations] update error:', error);
      return fail('internal', 'Failed to update conversation', 500);
    }
    if (!updated) return fail('not_found', 'Conversation not found', 404);

    const { data, error: readError } = await ctx.supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (readError || !data) return fail('internal', 'Failed to read conversation', 500);
    return ok(serializeConversation(normalizeConversation(data as Conversation)));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
