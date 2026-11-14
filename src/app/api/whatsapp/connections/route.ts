import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  listWabaPhoneNumbers,
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
  describeWabaPhoneMismatch,
  isNumericMetaId,
  phoneNumberBelongsToWaba,
} from '@/lib/whatsapp/waba-pairing';
import { encrypt } from '@/lib/whatsapp/encryption';
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
    `[whatsapp/connections] Meta ${step} failed:`,
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
 * GET /api/whatsapp/connections
 *
 * Lists every WhatsApp connection (custom + shared) for the caller's
 * account. Does not call out to Meta for a health check per row — that
 * stays on GET /api/whatsapp/connections/[id], which is what the UI
 * calls when a specific card is expanded.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer');

    const { data, error } = await supabase
      .from('whatsapp_config')
      .select(
        'id, mode, signup_type, label, phone_number_id, waba_id, display_phone_number, verified_name, status, registered_at, subscribed_apps_at, last_registration_error, connected_at, created_at'
      )
      .eq('account_id', accountId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error listing whatsapp_config:', error);
      return NextResponse.json(
        { error: t('whatsappConfig.fetchFailed') },
        { status: 500 }
      );
    }

    return NextResponse.json({ connections: data ?? [] });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error);
    }
    console.error('Error in WhatsApp connections GET:', error);
    return NextResponse.json(
      { error: t('common.internalServerError') },
      { status: 500 }
    );
  }
}

/**
 * POST /api/whatsapp/connections
 *
 * Creates a new **custom** (BYO Meta App) connection — the manual
 * entry flow. Always inserts a new row; an account may hold any
 * number of these alongside any number of shared (Embedded Signup)
 * connections created via POST .../connections/embedded-signup.
 *
 * Mirrors the verify → register → subscribe sequence the old
 * singleton POST /api/whatsapp/config used, minus the "one row per
 * account" upsert assumption.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(
      `whatsapp-admin:${userId}`,
      RATE_LIMITS.whatsappAdmin
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json();
    const { phone_number_id, waba_id, access_token, verify_token, pin, label } =
      body;

    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: t('whatsappConfig.credentialsRequired') },
        { status: 400 }
      );
    }

    if (!isNumericMetaId(phone_number_id)) {
      return NextResponse.json(
        { error: t('whatsappConfig.phoneIdDigits'), field: 'phone_number_id' },
        { status: 400 }
      );
    }
    if (
      waba_id !== undefined &&
      waba_id !== null &&
      waba_id !== '' &&
      !isNumericMetaId(waba_id)
    ) {
      return NextResponse.json(
        { error: t('whatsappConfig.wabaIdDigits'), field: 'waba_id' },
        { status: 400 }
      );
    }
    const metaCtx: MetaErrorContext = {
      phoneNumberId: phone_number_id,
      wabaId: waba_id || null,
    };

    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json(
          { error: t('whatsappConfig.pinDigits') },
          { status: 400 }
        );
      }
    }

    // A phone_number_id still maps to exactly one account at a time —
    // reject if a different account already claimed it.
    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', phone_number_id)
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

    let phoneInfo;
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken: access_token,
      });
    } catch (err) {
      return metaFailure(err, 'verify_number', metaCtx);
    }

    if (waba_id) {
      let wabaNumbers;
      try {
        wabaNumbers = await listWabaPhoneNumbers({
          wabaId: waba_id,
          accessToken: access_token,
        });
      } catch (err) {
        return metaFailure(err, 'waba_phone_numbers', metaCtx);
      }
      if (!phoneNumberBelongsToWaba(wabaNumbers, phone_number_id)) {
        return NextResponse.json(
          {
            error: describeWabaPhoneMismatch(
              wabaNumbers,
              phone_number_id,
              waba_id
            ),
            field: 'waba_id',
            meta: {
              code: null,
              subcode: null,
              fbtrace_id: null,
              step: 'waba_phone_numbers',
              field: 'waba_id',
              message: 'phone_number_id is not listed under waba_id',
            },
          },
          { status: 400 }
        );
      }
    }

    let encryptedAccessToken: string;
    let encryptedVerifyToken: string | null;
    try {
      encryptedAccessToken = encrypt(access_token);
      encryptedVerifyToken =
        typeof verify_token === 'string' && verify_token.trim()
          ? encrypt(verify_token.trim())
          : null;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown encryption error';
      console.error('Encryption failed:', message);
      return NextResponse.json(
        { error: t('whatsappConfig.encryptFailed') },
        { status: 500 }
      );
    }

    let registeredAt: string | null = null;
    let registrationError: string | null = null;
    let registrationMeta: ReturnType<typeof metaErrorPayload> | null = null;
    let registrationSkipped = false;

    if (!pin) {
      // See config/route.ts's historical comment — Meta TEST numbers
      // expose no 2FA PIN to set, so /register is best-effort.
      registrationSkipped = true;
    } else {
      try {
        await registerPhoneNumber({
          phoneNumberId: phone_number_id,
          accessToken: access_token,
          pin,
        });
        registeredAt = new Date().toISOString();
      } catch (err) {
        const explained = explainMetaError(err, 'register', metaCtx);
        registrationError = explained.summary;
        registrationMeta = metaErrorPayload(explained);
        console.error(
          'Phone number /register failed:',
          explained.metaMessage,
          registrationMeta
        );
      }
    }

    let subscribedAppsAt: string | null = null;
    if (waba_id) {
      try {
        await subscribeWabaToApp({
          wabaId: waba_id,
          accessToken: access_token,
        });
        subscribedAppsAt = new Date().toISOString();
      } catch (err) {
        return metaFailure(err, 'subscribe_waba', metaCtx);
      }
    }

    const { data: inserted, error: insertError } = await supabase
      .from('whatsapp_config')
      .insert({
        account_id: accountId,
        user_id: userId,
        mode: 'custom',
        label: typeof label === 'string' && label.trim() ? label.trim() : null,
        phone_number_id,
        waba_id: waba_id || null,
        display_phone_number: phoneInfo.display_phone_number ?? null,
        verified_name: phoneInfo.verified_name ?? null,
        access_token: encryptedAccessToken,
        verify_token: encryptedVerifyToken,
        status: registrationError ? 'disconnected' : 'connected',
        connected_at: registrationError ? null : new Date().toISOString(),
        registered_at: registrationError ? null : registeredAt,
        subscribed_apps_at: subscribedAppsAt,
        last_registration_error: registrationError,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('Error inserting whatsapp_config:', insertError);
      return NextResponse.json(
        { error: t('whatsappConfig.saveFailed') },
        { status: 500 }
      );
    }

    if (registrationError) {
      return NextResponse.json({
        success: false,
        saved: true,
        id: inserted.id,
        registered: false,
        registration_error: registrationError,
        error: registrationError,
        meta: registrationMeta,
        phone_info: phoneInfo,
      });
    }

    return NextResponse.json({
      success: true,
      saved: true,
      id: inserted.id,
      registered: registeredAt != null,
      registration_skipped: registrationSkipped,
      phone_info: phoneInfo,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error);
    }
    console.error('Error in WhatsApp connections POST:', error);
    return NextResponse.json(
      { error: t('common.internalServerError') },
      { status: 500 }
    );
  }
}
