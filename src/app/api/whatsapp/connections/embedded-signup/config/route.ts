import { NextResponse } from 'next/server';
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { getT } from '@/lib/i18n/translate';
import { metaValue } from '@/lib/platform-config';

const t = getT('Api');

/**
 * GET /api/whatsapp/connections/embedded-signup/config
 *
 * The non-secret bag the frontend needs to load the Facebook JS SDK
 * and call FB.login with the Tech Provider's Embedded Signup Login
 * Configuration. Deliberately NOT exposed as NEXT_PUBLIC_ build-time
 * vars - fetched at runtime instead, so a self-hosted deployment can
 * set these as ordinary server env vars without a rebuild, and so a
 * Worker secret never needs to be inlined into the client bundle.
 */
export async function GET() {
  try {
    await requireRole('admin');

    const appId = await metaValue('META_APP_ID');
    const configId = await metaValue('META_WHATSAPP_CONFIG_ID');
    if (!appId || !configId) {
      return NextResponse.json({ configured: false });
    }

    return NextResponse.json({
      configured: true,
      appId,
      graphApiVersion: (await metaValue('META_GRAPH_API_VERSION')) || 'v21.0',
      configId,
      coexistenceConfigId:
        (await metaValue('META_WHATSAPP_COEXISTENCE_CONFIG_ID')) || null,
      coexistenceFeatureType:
        (await metaValue('META_WHATSAPP_COEXISTENCE_FEATURE_TYPE')) ||
        'whatsapp_business_app_onboarding',
    });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error);
    }
    console.error('Error in embedded-signup config GET:', error);
    return NextResponse.json(
      { error: t('common.internalServerError') },
      { status: 500 }
    );
  }
}
