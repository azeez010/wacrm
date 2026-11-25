import * as Sentry from '@sentry/nextjs'

// Next calls register() once per server runtime. On Cloudflare the Worker entry
// (worker/custom-worker.ts) creates the Sentry client; these configs matter for
// `next dev` and keep the release id in sync. See sentry.server.config.ts.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./sentry.server.config')
  if (process.env.NEXT_RUNTIME === 'edge') await import('./sentry.edge.config')
}

// Reports errors thrown while rendering pages and in route handlers.
export const onRequestError = Sentry.captureRequestError
