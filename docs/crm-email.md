# CRM sync and platform email

Both are configured in the **admin console → Platform settings → Email & CRM** (migration 131), not in
environment variables. With nothing configured, the whole layer is a no-op and nothing is queued.

## Email: providers with failover

Every platform email goes out through the providers listed in the console, in order. The first enabled,
healthy one sends it; if it fails (bad key, unverified sender, rate limit, outage) the next one tries. A
provider that fails 3 times in a row is moved to the back for 5 minutes.

- Providers: **Brevo, Resend, SendGrid, Postmark, Mailgun, Amazon SES** (v2 API, SigV4-signed). Types and
  adapters are one dependency-free module, `src/lib/email/providers.ts`, kept byte-identical in the admin API
  (`ogadesk-api/src/lib/email-providers.ts`) and console (drift-tested there).
- Keys are encrypted with `PLATFORM_SECRETS_KEY` by the admin API and are write-only (hints only).
- The default sender (from address, name, reply-to) is set in the same tab; each provider can override it.
- "Send test" sends a real email through one provider, or through the whole chain.

Emails sent: welcome, usage alerts (80% / 100%), renewal and trial reminders, form sign-in codes (sent
directly, not through the outbox), and console notices (e.g. "your business was deleted", sent by the admin
API with the same providers). Supabase still sends the auth emails. Text lives in the `Emails` namespace of
`messages/*.json`.

**Fallback while nothing is set in the console:** the old `EMAIL_PROVIDER=brevo` + `BREVO_API_KEY` +
`EMAIL_FROM_ADDRESS` / `EMAIL_FROM_NAME` variables still work (`src/lib/email/platform.ts`). Once a provider
and the sender are saved in the console, those are used instead.

## CRM: OgaDesk's own workspace

Every person with a login becomes a contact in the **OgaDesk business's own workspace** in this app, through
that workspace's public API (`src/lib/crm/ogadesk.ts`). In that workspace, create an API key (Settings → API
keys) with `contacts:read, contacts:write, fields:read, fields:write`, then paste it and the app address in the
console and press "Test connection".

| Kind | Where it lands |
| --- | --- |
| Attributes (`src/lib/crm/attributes.ts`) | contact custom fields `oga_<name>` (created on the first sync); first and last name go to the contact name |
| Lists (All users, use cases, Marketing opt-in) | tags. Tags the team adds by hand are kept; only these are added or removed |
| Events (`onboarding_completed`, `quota_80`, ...) | an `event: <name>` tag plus `oga_last_event` / `oga_last_event_at` |

Contacts are matched by email; a person with no phone gets a contact with an empty phone (the public
`POST /api/v1/contacts` accepts `email` alone). The CRM workspace's own activity is never synced into itself.

**Marketing consent.** Everyone is synced, but only the `Marketing opt-in` tag reflects the onboarding
checkbox. Send campaigns only to that tag. The Brevo webhook (`/api/crm/webhooks/brevo`) still turns the
flag off on an unsubscribe, complaint or hard bounce if Brevo is one of your email providers.

## How it works

Changes enqueue a job in `crm_outbox` (a user sync, an event or an email) and return at once. Jobs are
drained after the response is sent and by the 5-minute cron trigger (`/api/crm/flush`), with retries at
1 min, 5 min, 30 min, 2 h and 12 h before a job is marked `dead` (look at `last_error`). Failover between
email providers happens inside one attempt; the retries cover every provider being down.

Backfill existing users once after the CRM is set up:
`CRM_BASE_URL=https://ogadesk.com AUTOMATION_CRON_SECRET=... npm run crm:backfill`

## Adding an email provider

One entry in `EMAIL_TYPES` and one case in `sendVia()` in `src/lib/email/providers.ts`, then copy the file to
the admin API and console (the drift test there fails until you do).
