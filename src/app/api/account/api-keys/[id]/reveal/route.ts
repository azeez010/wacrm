// ============================================================
// POST /api/account/api-keys/[id]/reveal  { password }
//
// Re-show an API key's plaintext to an admin who confirms their password.
// Returns { plaintext: string | null }: null for keys created before secrets
// were stored (only a hash exists), so the UI shows a placeholder instead.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { passwordIsCorrect, readKeySecret } from '@/lib/api-keys/secrets';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { getT } from '@/lib/i18n/translate';

const t = getT('Api');
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin');

    // Password guessing: tight per-user budget.
    const limit = checkRateLimit(`admin:apiKeyReveal:${ctx.userId}`, { limit: 5, windowMs: 60_000 });
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!password) return NextResponse.json({ error: t('account.apiKeys.passwordRequired') }, { status: 400, headers: NO_STORE });

    const { id } = await params;
    const { data: key } = await ctx.supabase
      .from('api_keys')
      .select('id, revoked_at, expires_at')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!key || key.revoked_at || (key.expires_at && new Date(key.expires_at).getTime() <= Date.now())) {
      return NextResponse.json({ error: t('account.apiKeys.notFoundOrRevoked') }, { status: 404, headers: NO_STORE });
    }

    const { data: auth } = await ctx.supabase.auth.getUser();
    const email = auth.user?.email;
    if (!email) return NextResponse.json({ error: t('account.apiKeys.noPasswordLogin') }, { status: 400, headers: NO_STORE });
    if (!(await passwordIsCorrect(email, password))) {
      return NextResponse.json({ error: t('account.apiKeys.wrongPassword') }, { status: 401, headers: NO_STORE });
    }

    return NextResponse.json({ plaintext: await readKeySecret(ctx.accountId, id) }, { headers: NO_STORE });
  } catch (err) {
    return toErrorResponse(err);
  }
}
