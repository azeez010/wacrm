// ============================================================
// What the Cloudflare Cron Trigger does. Cloudflare calls the Worker's
// `scheduled` handler on the schedule in wrangler.jsonc (every 5 minutes);
// that handler (worker/custom-worker.ts) runs these jobs by calling the app's
// own secret-guarded endpoints through the self-reference service binding, so
// the work runs inside the normal Next.js request context (database, env,
// logging) and the secrets never leave Cloudflare.
//
// A job whose secret is not configured is skipped (and logged), so turning on a
// feature = setting its secret; nothing else to wire.
// ============================================================

export interface CronEnv {
  /** Service binding to this same Worker (see wrangler.jsonc `services`). */
  WORKER_SELF_REFERENCE: { fetch(request: Request): Promise<Response> }
  AUTOMATION_CRON_SECRET?: string
}

export interface CronJob {
  name: string
  path: string
  method: 'GET' | 'POST'
  /** Which secret authorises the call (sent as `x-cron-secret`). */
  secret: 'AUTOMATION_CRON_SECRET'
}

/** The host the self-call is addressed to; the binding routes it to this Worker. */
export const CRON_ORIGIN = 'https://ogadesk.com'
const JOB_TIMEOUT_MS = 50_000

export const CRON_JOBS: readonly CronJob[] = [
  // Drain the CRM / email outbox (retries after a provider outage).
  { name: 'crm-flush', path: '/api/crm/flush', method: 'POST', secret: 'AUTOMATION_CRON_SECRET' },
  // Exchange rates for price display (one free-API call a day; the endpoint is a no-op otherwise).
  { name: 'fx-refresh', path: '/api/currency/refresh', method: 'POST', secret: 'AUTOMATION_CRON_SECRET' },
  // Time-based automations and "wait" steps.
  { name: 'automations', path: '/api/automations/cron', method: 'GET', secret: 'AUTOMATION_CRON_SECRET' },
  // Time out abandoned chatbot flow runs.
  { name: 'flows', path: '/api/flows/cron', method: 'GET', secret: 'AUTOMATION_CRON_SECRET' },
  // Pre-compute the views / leads / conversion shown on the forms list.
  { name: 'form-stats', path: '/api/forms/stats/cron', method: 'GET', secret: 'AUTOMATION_CRON_SECRET' },
]

export type CronOutcome = { job: string; result: number | 'skipped' | 'error' }

/** Run every job independently: one failing never stops the others. */
export async function runScheduled(env: CronEnv): Promise<CronOutcome[]> {
  return Promise.all(
    CRON_JOBS.map(async (job): Promise<CronOutcome> => {
      const secret = env[job.secret]
      if (!secret) {
        console.warn(`[cron] ${job.name} skipped: ${job.secret} is not set`)
        return { job: job.name, result: 'skipped' }
      }
      try {
        const res = await env.WORKER_SELF_REFERENCE.fetch(
          new Request(`${CRON_ORIGIN}${job.path}`, {
            method: job.method,
            headers: { 'x-cron-secret': secret },
            signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
          }),
        )
        if (!res.ok) console.error(`[cron] ${job.name} answered ${res.status}`)
        return { job: job.name, result: res.status }
      } catch (err) {
        console.error(`[cron] ${job.name} failed:`, err instanceof Error ? err.message : err)
        return { job: job.name, result: 'error' }
      }
    }),
  )
}
