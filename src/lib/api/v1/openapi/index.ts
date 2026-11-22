import { API_SCOPES, SCOPE_DESCRIPTIONS } from '@/lib/api-keys/scopes'
import { INTRODUCTION } from './guides'
import { paths } from './paths'
import { schemas } from './schemas'
import type { OpenApiObject } from './types'

/**
 * The OpenAPI 3.1 document for the public API, served at
 * GET /api/v1/openapi.json and rendered at /docs. Scopes and webhook events are
 * generated from the same constants the API enforces, so they cannot drift.
 */
export function buildOpenApiSpec(baseUrl: string): OpenApiObject {
  const scopeTable = [
    '## Scopes',
    '',
    'Grant a key only the scopes it needs.',
    '',
    '| Scope | Allows |',
    '| --- | --- |',
    ...API_SCOPES.map((s) => `| \`${s}\` | ${SCOPE_DESCRIPTIONS[s]} |`),
  ].join('\n')

  const errorResponse = (description: string) => ({
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  })

  return {
    openapi: '3.1.0',
    info: {
      title: 'OgaDesk API',
      version: '1.0.0',
      description: `${INTRODUCTION.replaceAll('{{BASE_URL}}', baseUrl)}\n\n${scopeTable}\n`,
      contact: { name: 'OgaDesk support', url: baseUrl },
    },
    servers: [{ url: `${baseUrl}/api/v1`, description: 'Production' }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Account', description: 'Check that your key works.' },
      { name: 'Verifications', description: 'Send one-time codes over WhatsApp and check them (OTP).' },
      { name: 'Messages', description: 'Send WhatsApp messages and read their delivery status.' },
      { name: 'Templates', description: 'Message templates (required for business-initiated messages).' },
      { name: 'Webhooks', description: 'Be notified about messages and delivery changes.' },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'An OgaDesk API key (`wacrm_live_…`) created in **Settings → API keys**.',
        },
      },
      schemas,
      responses: {
        BadRequest: errorResponse('Invalid input (`bad_request`).'),
        Unauthorized: errorResponse('Missing, malformed, unknown, revoked or expired key (`unauthorized`).'),
        PlanLimit: errorResponse('Your plan does not include this, or its limit is reached (`plan_limit`).'),
        Forbidden: errorResponse('The key lacks the required scope (`forbidden`).'),
        NotFound: errorResponse('Not found in your workspace (`not_found`).'),
        Conflict: errorResponse('Already exists (`conflict`).'),
        RateLimited: {
          description: 'Rate limit exceeded (`rate_limited`). Retry after `Retry-After` seconds.',
          headers: {
            'Retry-After': { schema: { type: 'integer' }, description: 'Seconds to wait.' },
            'X-RateLimit-Limit': { schema: { type: 'integer' } },
            'X-RateLimit-Remaining': { schema: { type: 'integer' } },
            'X-RateLimit-Reset': { schema: { type: 'integer' }, description: 'Unix seconds when the window resets.' },
          },
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        MetaError: errorResponse('WhatsApp (Meta) rejected the request (`meta_error`). The message carries Meta\'s reason.'),
      },
    },
  }
}
