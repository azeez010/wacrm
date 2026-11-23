// DELETE /api/v1/api-keys/{id} - revoke a key (scope: keys:manage).
// A key cannot revoke itself (that would end the very session that asked).
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { isUuid } from '@/lib/api/v1/pagination';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'keys:manage');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'API key not found', 404);
    if (id === ctx.keyId) return fail('bad_request', 'A key cannot revoke itself. Use another key, or Settings > API & MCP.', 400);

    const { data, error } = await ctx.supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[api/v1/api-keys] revoke error:', error);
      return fail('internal', 'Failed to revoke API key', 500);
    }
    if (!data) return fail('not_found', 'API key not found or already revoked', 404);
    return ok({ revoked: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
