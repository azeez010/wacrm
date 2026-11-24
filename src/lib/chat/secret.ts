// ============================================================
// The secret chat tokens are signed with. It must be the SAME value in the
// Worker entry (which verifies WebSocket upgrades from its bindings) and in
// the Next route handlers (which sign tokens), so both read it from the Worker
// environment: a dedicated CHAT_TOKEN_SECRET if one is set, otherwise the
// service-role secret that is already a Worker binding. (ENCRYPTION_KEY is not
// used: in production it only exists in the Next bundle, not as a binding.)
// Rotating the secret signs every visitor out of their chat; they just start a new one.
// ============================================================

export function pickChatSecret(env: Record<string, unknown> | undefined | null): string {
  for (const key of ['CHAT_TOKEN_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']) {
    const v = env?.[key]
    if (typeof v === 'string' && v.length >= 16) return v
  }
  return ''
}

/** For route handlers: the Worker environment first, process.env as the fallback (next dev, tests). */
export async function chatSecret(): Promise<string> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const fromWorker = pickChatSecret(getCloudflareContext().env as unknown as Record<string, unknown>)
    if (fromWorker) return fromWorker
  } catch {
    /* not running on Workers */
  }
  return pickChatSecret(process.env as Record<string, unknown>)
}
