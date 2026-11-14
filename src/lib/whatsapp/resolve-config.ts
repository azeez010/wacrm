import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from './encryption';

/**
 * A `whatsapp_config` row, typed loosely (selects `*` at call sites) —
 * narrowed here to the fields the resolver and its callers touch.
 */
export interface WhatsAppConfigRow {
  id: string;
  account_id: string;
  mode: 'shared' | 'custom';
  signup_type: 'new_number' | 'existing_number' | null;
  phone_number_id: string;
  waba_id: string | null;
  access_token: string | null;
  verify_token: string | null;
  status: string;
  [key: string]: unknown;
}

export class AmbiguousConnectionError extends Error {
  constructor() {
    super(
      'This account has more than one WhatsApp connection — specify whatsapp_config_id.'
    );
    this.name = 'AmbiguousConnectionError';
  }
}

export class NoConnectionError extends Error {
  constructor() {
    super('This account has no WhatsApp connection configured.');
    this.name = 'NoConnectionError';
  }
}

/**
 * Resolve a single `whatsapp_config` row for an account.
 *
 * - `configId` given → that row (scoped to `accountId`, so one
 *   account can never resolve another's connection by guessing an id).
 * - `configId` omitted, account has exactly one connection → that one
 *   (keeps every pre-multi-connection call site working unchanged).
 * - `configId` omitted, account has 0 or 2+ connections → throws
 *   `NoConnectionError` / `AmbiguousConnectionError` so the caller can
 *   surface a specific, actionable message instead of a generic 500.
 */
export async function resolveWhatsAppConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  accountId: string,
  configId?: string | null
): Promise<WhatsAppConfigRow> {
  if (configId) {
    const { data, error } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('id', configId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NoConnectionError();
    return data as WhatsAppConfigRow;
  }

  const { data, error } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId);
  if (error) throw error;
  if (!data || data.length === 0) throw new NoConnectionError();
  if (data.length > 1) throw new AmbiguousConnectionError();
  return data[0] as WhatsAppConfigRow;
}

/**
 * Resolve the Graph API credentials for a connection row.
 *
 * - `mode === 'custom'` — decrypt the row's own `access_token`, as
 *   every connection did before multi-connection support existed.
 * - `mode === 'shared'` — the row never stores a token. Every shared
 *   connection's Graph API calls reuse one platform-level system-user
 *   token (`META_SYSTEM_USER_ACCESS_TOKEN`), since Meta's Tech
 *   Provider permission model already grants that token access to
 *   any WABA that completed Embedded Signup with us.
 */
export function resolveWhatsAppCredentials(config: WhatsAppConfigRow): {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string | null;
} {
  if (config.mode === 'shared') {
    const accessToken = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error(
        'META_SYSTEM_USER_ACCESS_TOKEN is not configured — shared WhatsApp connections cannot send.'
      );
    }
    return {
      accessToken,
      phoneNumberId: config.phone_number_id,
      wabaId: config.waba_id,
    };
  }

  if (!config.access_token) {
    throw new Error(
      'This custom WhatsApp connection has no access token stored.'
    );
  }
  return {
    accessToken: decrypt(config.access_token),
    phoneNumberId: config.phone_number_id,
    wabaId: config.waba_id,
  };
}
