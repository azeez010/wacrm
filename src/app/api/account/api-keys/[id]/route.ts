// ============================================================
// DELETE /api/account/api-keys/[id] - revoke a key.
//
// Soft revoke: sets `revoked_at` rather than deleting the row, so
// the key's name/prefix stay visible in the roster as an audit
// trail ("this key existed and was turned off") and so the auth
// path's liveness check (`findActiveKeyByHash` filters revoked
// rows) starts rejecting it immediately. Admin+, enforced here and
// by the `api_keys_update` RLS policy.
//
// Revocation is effective on the next request: once `revoked_at` is
// set, `findActiveKeyByHash` returns null and the key 401s.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { normalizeScopes } from '@/lib/api-keys/scopes';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { getT } from '@/lib/i18n/translate';
import { onWorkspaceChanged } from '@/lib/onboarding/hooks';

const t = getT('Api');

/** PATCH - rename a key and/or change what it may do. Takes effect on its next request. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`admin:apiKeyEdit:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as { name?: unknown; scopes?: unknown; expiresInDays?: unknown } | null;
    const patch: Record<string, unknown> = {};
    if (body?.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return NextResponse.json({ error: t('account.apiKeys.nameRequired') }, { status: 400 });
      if (name.length > 80) return NextResponse.json({ error: t('account.apiKeys.nameTooLong', { max: 80 }) }, { status: 400 });
      patch.name = name;
    }
    if (body?.scopes !== undefined) {
      const scopes = normalizeScopes(body.scopes);
      if (scopes === null) return NextResponse.json({ error: t('account.apiKeys.scopesInvalid') }, { status: 400 });
      patch.scopes = scopes;
    }
    // expiresInDays: a number sets a new expiry from today (max 1 year); null removes it.
    if (body?.expiresInDays !== undefined) {
      if (body.expiresInDays === null) patch.expires_at = null;
      else if (typeof body.expiresInDays === 'number' && Number.isFinite(body.expiresInDays) && body.expiresInDays > 0) {
        patch.expires_at = new Date(Date.now() + Math.min(Math.floor(body.expiresInDays), 365) * 86_400_000).toISOString();
      } else return NextResponse.json({ error: t('account.apiKeys.expiryInvalid') }, { status: 400 });
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: t('account.apiKeys.nothingToChange') }, { status: 400 });

    const { id } = await params;
    const { data, error } = await ctx.supabase
      .from('api_keys')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .is('revoked_at', null)
      .select('id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at')
      .maybeSingle();
    if (error) {
      console.error('[PATCH /api/account/api-keys/[id]] error:', error);
      return NextResponse.json({ error: t('account.apiKeys.updateFailed') }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: t('account.apiKeys.notFoundOrRevoked') }, { status: 404 });
    return NextResponse.json({ key: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:apiKeyRevoke:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    // ?permanent=1: really delete a key that is already revoked (its stored secret goes with it).
    if (new URL(request.url).searchParams.get('permanent') === '1') {
      const { data: gone, error: delError } = await ctx.supabase
        .from('api_keys')
        .delete()
        .eq('id', id)
        .eq('account_id', ctx.accountId)
        .not('revoked_at', 'is', null)
        .select('id')
        .maybeSingle();
      if (delError) {
        console.error('[DELETE /api/account/api-keys/[id]?permanent] error:', delError);
        return NextResponse.json({ error: t('account.apiKeys.deleteFailed') }, { status: 500 });
      }
      if (!gone) return NextResponse.json({ error: t('account.apiKeys.deleteOnlyRevoked') }, { status: 404 });
      return NextResponse.json({ success: true });
    }

    // Scope the update by account_id as well as id so an admin can
    // never revoke another account's key by guessing a UUID. (RLS
    // already enforces this; the explicit filter is belt-and-braces
    // and makes the "0 rows updated → 404" path precise.)
    const { data, error } = await ctx.supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[DELETE /api/account/api-keys/[id]] error:', error);
      return NextResponse.json(
        { error: t('account.apiKeys.revokeFailed') },
        { status: 500 }
      );
    }
    if (!data) {
      // Either no such key in this account, or it was already revoked.
      return NextResponse.json(
        { error: t('account.apiKeys.notFoundOrRevoked') },
        { status: 404 }
      );
    }

    await onWorkspaceChanged(ctx.accountId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
