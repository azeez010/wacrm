// ============================================================
// /api/account/api-keys
//
//   GET  - list this account's API keys (safe columns only).
//   POST - mint a new key.
//
// These are the *dashboard* endpoints for managing keys, so they
// authenticate the normal way (cookie session) and go through the
// RLS client. Listing is open to any member (viewer+) - the roster
// is not secret; the secret (the key itself) is never in it. Minting
// is admin+ (a key hands out capabilities), enforced by both
// `requireRole('admin')` here and the `api_keys_insert` RLS policy.
//
// The plaintext key is returned in the POST response. We persist its SHA-256
// hash for authentication, plus an ENCRYPTED copy in `api_key_secrets`
// (service-role only) that an admin can re-show after confirming their
// password (POST .../[id]/reveal). Keys made before that have no copy.
// ============================================================

import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { generateApiKey } from '@/lib/api-keys/keys';
import { storeKeySecret } from '@/lib/api-keys/secrets';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  assertFeature,
  assertWithinLimit,
  FeatureLockedError,
  PlanLimitError,
} from '@/lib/billing/entitlements';
import { normalizeScopes } from '@/lib/api-keys/scopes';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { getT } from '@/lib/i18n/translate';
import { onApiKeyCreated } from '@/lib/onboarding/hooks';

const t = getT('Api');

const MAX_NAME_LEN = 80;
// Hard ceiling on caller-supplied expiry (1 year), mirroring the
// invite-link clamp. NULL/absent = never expires.
const MAX_EXPIRY_DAYS = 365;

// Columns safe to expose. `key_hash` is deliberately excluded - it
// never leaves the server.
const SAFE_COLUMNS =
  'id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at';

export async function GET() {
  try {
    // Any member can view the roster (RLS allows it); we just need a
    // resolved account context.
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from('api_keys')
      .select(SAFE_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /api/account/api-keys] fetch error:', error);
      return NextResponse.json(
        { error: t('account.apiKeys.loadFailed') },
        { status: 500 }
      );
    }

    // Which keys can be re-shown (they have an encrypted copy). The secret itself never leaves the server.
    const ids = (data ?? []).map((k) => k.id as string);
    const withSecret = new Set<string>();
    if (ids.length > 0) {
      const { data: rows } = await supabaseAdmin().from('api_key_secrets').select('key_id').in('key_id', ids);
      for (const r of (rows ?? []) as { key_id: string }[]) withSecret.add(r.key_id);
    }

    // Whether the plan includes MCP, so the UI can offer an upgrade instead of a URL that would 402.
    const mcpIncluded = await assertFeature(ctx.supabase, ctx.accountId, 'mcp').then(
      () => true,
      () => false
    );

    return NextResponse.json({ mcp: { included: mcpIncluded }, keys: (data ?? []).map((k) => ({ ...k, has_secret: withSecret.has(k.id as string) })) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:apiKeyCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      scopes?: unknown;
      expiresInDays?: unknown;
    } | null;

    const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!rawName) {
      return NextResponse.json(
        { error: t('account.apiKeys.nameRequired') },
        { status: 400 }
      );
    }
    if (rawName.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: t('account.apiKeys.nameTooLong', { max: MAX_NAME_LEN }) },
        { status: 400 }
      );
    }

    // Scopes default to none if omitted - that yields a key that can
    // only call the scope-free endpoints (e.g. GET /api/v1/me).
    const scopes = normalizeScopes(body?.scopes ?? []);
    if (scopes === null) {
      return NextResponse.json(
        { error: t('account.apiKeys.scopesInvalid') },
        { status: 400 }
      );
    }

    let expiresAt: string | null = null;
    const rawExpiry = body?.expiresInDays;
    if (
      typeof rawExpiry === 'number' &&
      Number.isFinite(rawExpiry) &&
      rawExpiry > 0
    ) {
      const days = Math.min(Math.floor(rawExpiry), MAX_EXPIRY_DAYS);
      expiresAt = new Date(
        Date.now() + days * 24 * 60 * 60 * 1000
      ).toISOString();
    }

    // Plan: the public API is a feature and the number of active keys is capped.
    await assertFeature(ctx.supabase, ctx.accountId, 'public_api');
    const { count: activeKeys } = await ctx.supabase
      .from('api_keys')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
      .is('revoked_at', null);
    await assertWithinLimit(ctx.supabase, ctx.accountId, 'api_keys', activeKeys ?? 0);

    const { plaintext, hash, prefix } = generateApiKey();

    const { data, error } = await ctx.supabase
      .from('api_keys')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        name: rawName,
        key_prefix: prefix,
        key_hash: hash,
        scopes,
        expires_at: expiresAt,
      })
      .select(SAFE_COLUMNS)
      .single();

    if (error || !data) {
      console.error('[POST /api/account/api-keys] insert error:', error);
      return NextResponse.json(
        { error: t('account.apiKeys.createFailed') },
        { status: 500 }
      );
    }

    // Keep an encrypted copy so an admin can re-show the setup later (best effort).
    await storeKeySecret(ctx.accountId, data.id as string, plaintext);

    await onApiKeyCreated(ctx.accountId, ctx.userId);

    return NextResponse.json(
      {
        key: data,
        // Plaintext - shown to the admin exactly once.
        plaintext,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof PlanLimitError || err instanceof FeatureLockedError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    return toErrorResponse(err);
  }
}
