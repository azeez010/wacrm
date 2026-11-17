import { requireApiKey, type ApiKeyContext } from '@/lib/auth/api-context';
import { hasScope, type ApiScope } from '@/lib/api-keys/scopes';
import { forbidden } from '@/lib/api/v1/respond';

/**
 * Authenticate, then require ANY of the listed scopes. For shared
 * helper endpoints (tags, team members) that several features need -
 * e.g. an automation builder needs tag ids but may hold no contacts scope.
 */
export async function requireAnyScope(
  request: Request,
  scopes: ApiScope[]
): Promise<ApiKeyContext> {
  const ctx = await requireApiKey(request);
  if (!scopes.some((s) => hasScope(ctx.scopes, s))) {
    throw forbidden(
      `This API key needs one of these scopes: ${scopes.map((s) => `'${s}'`).join(', ')}`
    );
  }
  return ctx;
}
