import { NextResponse } from 'next/server';
import { metaValue } from '@/lib/platform-config';
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { getSubscribedApps, verifyPhoneNumber } from '@/lib/whatsapp/meta-api';
import {
  explainMetaError,
  metaErrorPayload,
} from '@/lib/whatsapp/meta-error-explain';
import { appSubscriptionState } from '@/lib/whatsapp/waba-pairing';
import { encrypt } from '@/lib/whatsapp/encryption';
import {
  resolveWhatsAppConfig,
  resolveWhatsAppCredentialsAsync,
  NoConnectionError,
} from '@/lib/whatsapp/resolve-config';
import { getT } from '@/lib/i18n/translate';
import { onWhatsAppDisconnected } from '@/lib/onboarding/hooks';

const t = getT('Api');

/**
 * GET /api/whatsapp/connections/[id]
 *
 * Health check for one connection - same shape the old singleton
 * GET /api/whatsapp/config returned, now scoped by id. Returns 200
 * in every non-auth failure mode so the UI can render a specific
 * message instead of a generic error.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const { id } = await params;

    let config;
    try {
      config = await resolveWhatsAppConfig(supabase, accountId, id);
    } catch (err) {
      if (err instanceof NoConnectionError) {
        return NextResponse.json(
          {
            connected: false,
            reason: 'no_config',
            message: t('whatsappConfig.noConfig'),
          },
          { status: 200 }
        );
      }
      throw err;
    }

    let accessToken: string;
    try {
      accessToken = (await resolveWhatsAppCredentialsAsync(config)).accessToken;
    } catch (err) {
      console.error(
        '[whatsapp/connections GET] Credential resolution failed:',
        err
      );
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message: t('whatsappConfig.tokenCorrupted'),
        },
        { status: 200 }
      );
    }

    let phoneInfo;
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
      });
    } catch (err) {
      const explained = explainMetaError(err, 'verify_number', {
        phoneNumberId: config.phone_number_id,
        wabaId: config.waba_id,
      });
      console.error(
        '[whatsapp/connections GET] Meta API verification failed:',
        explained.metaMessage
      );
      return NextResponse.json(
        {
          connected: false,
          reason: 'meta_api_error',
          message: explained.summary,
          meta: metaErrorPayload(explained),
        },
        { status: 200 }
      );
    }

    let wabaSubscription: {
      checked: boolean;
      subscribed: boolean | null;
      app_id_match: boolean | null;
      error?: string;
    } = { checked: false, subscribed: null, app_id_match: null };
    if (config.waba_id) {
      try {
        const subs = await getSubscribedApps({
          wabaId: config.waba_id,
          accessToken,
        });
        const state = appSubscriptionState(subs, await metaValue('META_APP_ID'));
        wabaSubscription = {
          checked: true,
          subscribed: state.subscribed,
          app_id_match: state.appIdMatch,
        };
      } catch (err) {
        const explained = explainMetaError(err, 'subscribed_apps', {
          wabaId: config.waba_id,
        });
        wabaSubscription = {
          checked: true,
          subscribed: null,
          app_id_match: null,
          error: explained.summary,
        };
      }
    }

    return NextResponse.json({
      connected: true,
      mode: config.mode,
      signup_type: config.signup_type,
      phone_info: phoneInfo,
      waba_subscription: wabaSubscription,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error);
    }
    console.error('Error in WhatsApp connections [id] GET:', error);
    return NextResponse.json(
      {
        connected: false,
        reason: 'unknown',
        message: t('common.internalServerError'),
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/whatsapp/connections/[id]
 *
 * Updates a connection's label, or (custom connections only) its
 * access_token / verify_token / pin - re-running the same verify
 * step a fresh manual-entry POST would. Shared (Embedded Signup)
 * connections have nothing of this sort to rotate here; disconnect
 * and reconnect through the Embedded Signup flow instead.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { id } = await params;
    const body = await request.json();

    const config = await resolveWhatsAppConfig(supabase, accountId, id);

    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (typeof body.label === 'string') {
      update.label = body.label.trim() || null;
    }

    if (config.mode === 'custom') {
      if (typeof body.access_token === 'string' && body.access_token.trim()) {
        try {
          update.access_token = encrypt(body.access_token.trim());
        } catch (err) {
          console.error('Encryption failed:', err);
          return NextResponse.json(
            { error: t('whatsappConfig.encryptFailed') },
            { status: 500 }
          );
        }
      }
      if (typeof body.verify_token === 'string' && body.verify_token.trim()) {
        update.verify_token = encrypt(body.verify_token.trim());
      }
    }

    const { error } = await supabase
      .from('whatsapp_config')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId);
    if (error) {
      console.error('Error updating whatsapp_config:', error);
      return NextResponse.json(
        { error: t('whatsappConfig.updateFailed') },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error);
    }
    if (error instanceof NoConnectionError) {
      return NextResponse.json(
        { error: t('whatsappConfig.noConfig') },
        { status: 404 }
      );
    }
    console.error('Error in WhatsApp connections [id] PATCH:', error);
    return NextResponse.json(
      { error: t('common.internalServerError') },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/whatsapp/connections/[id]
 *
 * Removes a connection outright - custom and shared alike. (There is
 * no pool to release a shared connection back to; "shared" only
 * describes whose Meta App the tenant onboarded through, not shared
 * inventory, so deleting it is the same operation either way.)
 * Historical conversations/message_templates keep their
 * whatsapp_config_id reference nulled via ON DELETE SET NULL.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { id } = await params;

    const { error, count } = await supabase
      .from('whatsapp_config')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('account_id', accountId);

    if (error) {
      console.error('Error deleting whatsapp_config:', error);
      return NextResponse.json(
        { error: t('whatsappConfig.deleteFailed') },
        { status: 500 }
      );
    }
    if (!count) {
      return NextResponse.json(
        { error: t('whatsappConfig.noConfig') },
        { status: 404 }
      );
    }

    await onWhatsAppDisconnected(accountId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error);
    }
    console.error('Error in WhatsApp connections [id] DELETE:', error);
    return NextResponse.json(
      { error: t('common.internalServerError') },
      { status: 500 }
    );
  }
}
