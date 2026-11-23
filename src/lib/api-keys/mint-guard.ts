import { normalizeScopes, type ApiScope } from './scopes'

/**
 * Which scopes may a key hand to a NEW key? Only ones it has itself, never `keys:manage`.
 * (So a leaked or over-curious app key cannot grow its own powers by minting a stronger key.)
 */
export function checkMintScopes(
  requested: unknown,
  callerScopes: readonly string[],
): { ok: true; scopes: ApiScope[] } | { ok: false; status: 400 | 403; error: string } {
  const scopes = normalizeScopes(requested)
  if (scopes === null) return { ok: false, status: 400, error: "'scopes' must be an array of known scope names" }
  if (scopes.length === 0) return { ok: false, status: 400, error: "'scopes' must list at least one scope" }
  if (scopes.includes('keys:manage')) {
    return { ok: false, status: 403, error: "A key created this way cannot have 'keys:manage'. Create that key in Settings > API & MCP." }
  }
  const extra = scopes.filter((s) => !callerScopes.includes(s))
  if (extra.length > 0) {
    return { ok: false, status: 403, error: `This key cannot grant scopes it does not have: ${extra.join(', ')}` }
  }
  return { ok: true, scopes }
}
