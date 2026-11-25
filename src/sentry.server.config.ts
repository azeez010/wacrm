import * as Sentry from '@sentry/nextjs'

import { sentryOptions } from '@/lib/monitoring/config'

Sentry.init(
  sentryOptions({
    dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE,
  }),
)
