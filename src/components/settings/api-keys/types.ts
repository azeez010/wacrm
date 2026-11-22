export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  /** An encrypted copy exists, so an admin can re-show the key. */
  has_secret?: boolean;
}

export function keyStatus(k: ApiKey): 'active' | 'revoked' | 'expired' {
  if (k.revoked_at) return 'revoked';
  if (k.expires_at && new Date(k.expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
}
