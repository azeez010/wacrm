// ============================================================
// GET  /api/v1/api-keys - list this account's keys (scope: keys:manage)
// POST /api/v1/api-keys - mint a key                (scope: keys:manage)
//
// Guardrails (a key that can mint keys must not be a way around its own limits):
//  - the new key can only carry scopes the calling key already has;
//  - it can never carry `keys:manage` (an app key cannot mint more minters);
//  - the plan's key limit applies; expiry is capped at 1 year.
// The plaintext key is in the POST response once; an encrypted copy lets an admin
// re-show it in Settings > API & MCP.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { generateApiKey } from '@/lib/api-keys/keys';
import { storeKeySecret } from '@/lib/api-keys/secrets';
import { checkMintScopes } from '@/lib/api-keys/mint-guard';
import { assertWithinLimit } from '@/lib/billing/entitlements';

const SAFE_COLUMNS = 'id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at';
const MAX_EXPIRY_DAYS = 365;

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'keys:manage');
    const { data, error } = await ctx.supabase
      .from('api_keys')
      .select(SAFE_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[api/v1/api-keys] list error:', error);
      return fail('internal', 'Failed to list API keys', 500);
    }
    return okList(data ?? [], null);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'keys:manage');
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) return fail('bad_request', "'name' is required (max 80 characters)", 400);

    const guard = checkMintScopes(body.scopes, ctx.scopes);
    if (!guard.ok) return fail(guard.status === 403 ? 'forbidden' : 'bad_request', guard.error, guard.status);

    let expiresAt: string | null = null;
    if (typeof body.expires_in_days === 'number' && Number.isFinite(body.expires_in_days) && body.expires_in_days > 0) {
      const days = Math.min(Math.floor(body.expires_in_days), MAX_EXPIRY_DAYS);
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    }

    const { count: active } = await ctx.supabase
      .from('api_keys')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
      .is('revoked_at', null);
    await assertWithinLimit(ctx.supabase, ctx.accountId, 'api_keys', active ?? 0);

    const { plaintext, hash, prefix } = generateApiKey();
    const { data, error } = await ctx.supabase
      .from('api_keys')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.createdBy,
        name,
        key_prefix: prefix,
        key_hash: hash,
        scopes: guard.scopes,
        expires_at: expiresAt,
      })
      .select(SAFE_COLUMNS)
      .single();
    if (error || !data) {
      console.error('[api/v1/api-keys] insert error:', error);
      return fail('internal', 'Failed to create API key', 500);
    }
    await storeKeySecret(ctx.accountId, data.id as string, plaintext);
    return ok({ key: data, plaintext }, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
