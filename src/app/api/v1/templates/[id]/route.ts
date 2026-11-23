// ============================================================
// GET    /api/v1/templates/{id} - read one template (scope: templates:read)
// DELETE /api/v1/templates/{id} - delete it on Meta, then locally (scope: templates:write)
// Account-scoped: a foreign id → 404.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { isUuid } from '@/lib/api/v1/pagination';
import { deleteTemplateForAccount } from '@/lib/whatsapp/template-delete';

const TEMPLATE_SELECT =
  'id, name, category, language, status, header_type, header_content, body_text, footer_text, buttons, sample_values, meta_template_id, rejection_reason, submission_error, whatsapp_config_id, last_submitted_at, created_at';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'templates:read');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Template not found', 404);
    const { data, error } = await ctx.supabase
      .from('message_templates')
      .select(TEMPLATE_SELECT)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) {
      console.error('[api/v1/templates] read error:', error);
      return fail('internal', 'Failed to read template', 500);
    }
    if (!data) return fail('not_found', 'Template not found', 404);
    return ok(data);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'templates:write');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Template not found', 404);
    const result = await deleteTemplateForAccount(ctx.supabase, ctx.accountId, id);
    if (!result.ok) {
      const code = result.status === 404 ? 'not_found' : result.status === 400 ? 'bad_request' : 'internal';
      return fail(code, result.message, result.status);
    }
    return ok({ deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
