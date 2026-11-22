// ============================================================
// GET /api/v1/messages/{id} - one message, including its delivery status and,
// when WhatsApp could not deliver it, the reason. Scope `messages:read`.
//
// `{id}` is the `message_id` returned when you sent the message. Use it to poll
// delivery without listing a whole conversation.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { isUuid } from '@/lib/api/v1/pagination';
import { serializeMessage } from '@/lib/api/v1/conversations';
import type { Message } from '@/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'messages:read');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Message not found', 404);

    const { data: message } = await ctx.supabase
      .from('messages')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!message) return fail('not_found', 'Message not found', 404);

    // Tenancy: a message belongs to an account through its conversation.
    const { data: conv } = await ctx.supabase
      .from('conversations')
      .select('id')
      .eq('id', message.conversation_id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!conv) return fail('not_found', 'Message not found', 404);

    return ok(serializeMessage(message as Message));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
