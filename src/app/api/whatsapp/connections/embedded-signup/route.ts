import { NextResponse } from 'next/server';
import { metaValue } from '@/lib/platform-config';
import { PlanLimitError, assertCanAddWhatsAppConnection } from '@/lib/billing/entitlements';
import { onWhatsAppConnected } from '@/lib/onboarding/hooks';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  exchangeEmbeddedSignupCode,
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api';
import {
  explainMetaError,
  metaErrorPayload,
  type MetaConnectStep,
  type MetaErrorContext,
} from '@/lib/whatsapp/meta-error-explain';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { getT } from '@/lib/i18n/translate';

const t = getT('Api');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

function metaFailure(
  err: unknown,
  step: MetaConnectStep,
  ctx: MetaErrorContext
) {
  const explained = explainMetaError(err, step, ctx);
  console.error(
    `[whatsapp/embedded-signup] Meta ${step} failed:`,
    explained.metaMessage,
    {
      code: explained.code,
      subcode: explained.subcode,
      fbtrace_id: explained.fbtraceId,
    }
  );
  return NextResponse.json(
    { error: explained.summary, meta: metaErrorPayload(explained) },
    { status: explained.httpStatus }
  );
}

/**
 * POST /api/whatsapp/connections/embedded-signup
 *
 * Completes a Tech Provider Embedded Signup - ported from the user's
 * own working implementation of this exact flow in a sister product.
 * Body: `{ code, wabaId, phoneNumberId, isCoexistence }`, matching what
 * the frontend's FB.login callback + WA_EMBEDDED_SIGNUP postMessage
 * listener captures.
 *
 * Unlike the manual/custom connection flow, no access token is ever
 * persisted - the `code` exchange only finalizes Meta's Tech Provider
 * asset-sharing grant (needed for the webhook subscribe call below);
 * every later Graph API call for this connection reuses the
 * platform's own long-lived META_SYSTEM_USER_ACCESS_TOKEN instead,
 * per Meta's Tech Provider permission model.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(
      `whatsapp-admin:${userId}`,
      RATE_LIMITS.whatsappAdmin
    );
    if (!limit.success) return rateLimitResponse(limit);

    // Plan gate - before any Meta side effects.
    await assertCanAddWhatsAppConnection(supabase, accountId);

    const body = await request.json();
    const { code, wabaId, phoneNumberId, isCoexistence } = body as {
      code?: string;
      wabaId?: string;
      phoneNumberId?: string;
      isCoexistence?: boolean;
    };

    if (!code || !wabaId || !phoneNumberId) {
      return NextResponse.json(
        { error: 'code, wabaId and phoneNumberId are required.' },
        { status: 400 }
      );
    }

    const appId = await metaValue('META_APP_ID');
    const appSecret = await metaValue('META_APP_SECRET');
    const systemUserToken = await metaValue('META_SYSTEM_USER_ACCESS_TOKEN');
    if (!appId || !appSecret || !systemUserToken) {
      console.error(
        '[whatsapp/embedded-signup] Missing META_APP_ID / META_APP_SECRET / META_SYSTEM_USER_ACCESS_TOKEN'
      );
      return NextResponse.json(
        { error: t('common.internalServerError') },
        { status: 500 }
      );
    }

    const metaCtx: MetaErrorContext = { phoneNumberId, wabaId };

    // A phone_number_id still maps to exactly one account at a time -
    // reject if a different account already claimed it (same check
    // custom connections get).
    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', phoneNumberId)
      .neq('account_id', accountId)
      .maybeSingle();
    if (claimedError) {
      console.error('Error checking phone_number_id ownership:', claimedError);
      return NextResponse.json(
        { error: t('whatsappConfig.validateFailed') },
        { status: 500 }
      );
    }
    if (claimed) {
      return NextResponse.json(
        { error: t('whatsappConfig.numberLinkedElsewhere') },
        { status: 409 }
      );
    }

    // Step 1 - finalize the Tech Provider grant. Never persisted.
    let exchangedToken: string;
    try {
      exchangedToken = (
        await exchangeEmbeddedSignupCode({ code, appId, appSecret })
      ).accessToken;
    } catch (err) {
      return metaFailure(err, 'verify_number', metaCtx);
    }

    // Step 2 - register the number, UNLESS this is a coexistence
    // connection: the number is already live in the WhatsApp Business
    // app, and Cloud API's /register + PIN flow doesn't apply to it.
    if (!isCoexistence) {
      const pin = String(Math.floor(100000 + Math.random() * 900000));
      try {
        await registerPhoneNumber({
          phoneNumberId,
          accessToken: systemUserToken,
          pin,
        });
      } catch (err) {
        return metaFailure(err, 'register', metaCtx);
      }
    }

    // Step 3 - subscribe the WABA to our app. Must use the just-
    // exchanged token, not the system token - the system token lacks
    // subscribe-rights on a WABA it wasn't itself party to granting
    // access to at this moment.
    try {
      await subscribeWabaToApp({ wabaId, accessToken: exchangedToken });
    } catch (err) {
      return metaFailure(err, 'subscribe_waba', metaCtx);
    }

    // Step 4 - phone details, for display in the connections list.
    let phoneInfo;
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId,
        accessToken: systemUserToken,
      });
    } catch (err) {
      return metaFailure(err, 'verify_number', metaCtx);
    }

    const { data: inserted, error: insertError } = await supabase
      .from('whatsapp_config')
      .insert({
        account_id: accountId,
        user_id: userId,
        mode: 'shared',
        signup_type: isCoexistence ? 'existing_number' : 'new_number',
        phone_number_id: phoneNumberId,
        waba_id: wabaId,
        display_phone_number: phoneInfo.display_phone_number ?? null,
        verified_name: phoneInfo.verified_name ?? null,
        access_token: null,
        verify_token: null,
        status: 'connected',
        connected_at: new Date().toISOString(),
        registered_at: isCoexistence ? null : new Date().toISOString(),
        subscribed_apps_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertError) {
      console.error(
        'Error inserting whatsapp_config (embedded signup):',
        insertError
      );
      return NextResponse.json(
        { error: t('whatsappConfig.saveFailed') },
        { status: 500 }
      );
    }

    await onWhatsAppConnected(accountId, inserted.id, {
      mode: 'shared',
      signup_type: isCoexistence ? 'existing_number' : 'new_number',
    });

    return NextResponse.json({
      success: true,
      id: inserted.id,
      phone_info: phoneInfo,
    });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return NextResponse.json(
        { error: error.message, code: 'plan_limit', limit_key: error.limitKey, limit: error.limit, plan: error.planName },
        { status: 402 }
      );
    }
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error);
    }
    console.error('Error in WhatsApp embedded-signup POST:', error);
    return NextResponse.json(
      { error: t('common.internalServerError') },
      { status: 500 }
    );
  }
}
