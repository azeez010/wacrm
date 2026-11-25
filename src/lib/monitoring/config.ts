// ============================================================
// Shared Sentry options for the browser, the Next server and the Worker.
//
// Sentry stays OFF until a DSN is configured, so the app runs unchanged without
// it. Privacy defaults: no default PII, no session replay (it would record
// customer conversations), and every event passes through scrubEvent.
// ============================================================

import { scrubEvent, type ScrubbableEvent } from './scrub'

/** Errors that are noise, not bugs. */
export const IGNORED_ERRORS: (string | RegExp)[] = [
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications',
  /^NEXT_REDIRECT/,
  /^NEXT_NOT_FOUND/,
  'AbortError',
  'The operation was aborted',
  /Failed to fetch$/,
  /Load failed$/,
  /NetworkError when attempting to fetch resource/,
  /Non-Error promise rejection captured/,
]

/** 0..1 from a string, falling back to `fallback` when missing or invalid. */
export function parseSampleRate(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback
}

export interface MonitoringEnv {
  dsn?: string
  environment?: string
  release?: string
  tracesSampleRate?: string
}

/** Options common to every runtime. `enabled` is false without a DSN. */
export function sentryOptions(env: MonitoringEnv) {
  const dsn = env.dsn?.trim() || undefined
  return {
    dsn,
    enabled: !!dsn,
    environment: env.environment || 'production',
    release: env.release || undefined,
    // Performance: sample a tenth of requests by default (raise temporarily when investigating).
    tracesSampleRate: parseSampleRate(env.tracesSampleRate, 0.1),
    sendDefaultPii: false,
    ignoreErrors: IGNORED_ERRORS,
    beforeSend: <E extends ScrubbableEvent>(event: E): E => scrubEvent(event),
    beforeSendTransaction: <E extends ScrubbableEvent>(event: E): E => scrubEvent(event),
  }
}
