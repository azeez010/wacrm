import * as Sentry from '@sentry/nextjs'

import { sentryOptions } from '@/lib/monitoring/config'

// Browser errors and page performance. NEXT_PUBLIC_* values are baked in at build time.
// No session replay on purpose: it would record customer conversations.
Sentry.init({
  ...sentryOptions({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
  }),
  // Only trace our own pages and API, not third-party calls.
  tracePropagationTargets: [/^\//],
})

// Lets Sentry time client-side route changes.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
