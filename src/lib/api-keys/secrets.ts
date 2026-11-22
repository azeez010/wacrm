// ============================================================
// Encrypted copies of API keys, so an admin can re-show a key's setup
// after confirming their password. Service-role only: the table has no
// RLS policies (migration 079), and every caller here has already checked
// the role (and, for reads, the password).
// ============================================================

import { createClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

/** Best effort: a failure only means this key can't be re-shown later. */
export async function storeKeySecret(accountId: string, keyId: string, plaintext: string): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin()
      .from('api_key_secrets')
      .insert({ key_id: keyId, account_id: accountId, secret_encrypted: encrypt(plaintext) });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    console.error('[api-keys/secrets] could not store the secret:', e instanceof Error ? e.message : e);
    return false;
  }
}

/** The key's plaintext, or null for keys created before secrets were stored (or if it cannot be read). */
export async function readKeySecret(accountId: string, keyId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from('api_key_secrets')
    .select('secret_encrypted')
    .eq('key_id', keyId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!data) return null;
  try {
    return decrypt((data as { secret_encrypted: string }).secret_encrypted);
  } catch {
    return null;
  }
}

/**
 * Check a password without touching the caller's session: a throwaway client that
 * never persists anything. True only when email + password sign in.
 */
export async function passwordIsCorrect(email: string, password: string): Promise<boolean> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  // Drop only the session this check just created. A plain signOut() is GLOBAL: it would end
  // every session of the user, including the browser they are using right now.
  await supabaseAdmin().auth.admin.signOut(data.session.access_token, 'local').catch(() => {});
  return true;
}
