// /api/v1/tags - list and find-or-create tags. Automations and flows
// reference tags by id, so builders need this even without contacts scopes.
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { requireAnyScope } from '@/lib/api/v1/scope';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';

const READ = ['contacts:read', 'automations:read', 'flows:read', 'pipelines:read'] as const;
const WRITE = ['contacts:write', 'automations:write', 'flows:write'] as const;

export async function GET(request: Request) {
  try {
    const ctx = await requireAnyScope(request, [...READ, ...WRITE]);
    const { data, error } = await ctx.supabase
      .from('tags')
      .select('id, name, color, created_at')
      .eq('account_id', ctx.accountId)
      .order('name', { ascending: true });
    if (error) return fail('internal', 'Failed to list tags', 500);
    return ok(data ?? []);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAnyScope(request, [...WRITE]);
    const body = (await request.json().catch(() => null)) as { name?: unknown; color?: unknown } | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 50) {
      return fail('bad_request', "'name' is required (max 50 chars)", 400);
    }
    const color =
      typeof body?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : '#3b82f6';

    const { data: existing } = await ctx.supabase
      .from('tags')
      .select('id, name, color, created_at')
      .eq('account_id', ctx.accountId)
      .ilike('name', name.replace(/[%_]/g, (c) => `\\${c}`))
      .maybeSingle();
    if (existing) return ok(existing);

    const userId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    const { data, error } = await ctx.supabase
      .from('tags')
      .insert({ account_id: ctx.accountId, user_id: userId, name, color })
      .select('id, name, color, created_at')
      .single();
    if (error) return fail('internal', 'Failed to create tag', 500);
    return ok(data, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
