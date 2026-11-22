# CRM sync and transactional email (Brevo)

OgaDesk keeps a CRM in sync with every user and sends a few service emails. It is
**provider-agnostic**: the app talks to the interfaces in `src/lib/crm/types.ts`, and
Brevo is one adapter (`src/lib/crm/brevo.ts`). With nothing configured the whole layer
is a no-op and nothing is queued.

## What is synced

Every person with a login becomes a Brevo contact (looked up by email):

| Kind | What |
| --- | --- |
| Attributes | `FIRSTNAME, LASTNAME, ROLE, USE_CASES, HEARD_FROM, HEARD_FROM_DETAIL, REFERRAL_CODE, ONBOARDED_AT, PLAN, PLAN_STATUS, BILLING_INTERVAL, PLAN_RENEWS_AT, LIFETIME_PAID, LANGUAGE, COUNTRY, TIMEZONE, SIGNED_UP_AT, WHATSAPP_CONNECTED, WHATSAPP_NUMBERS, API_KEYS, WEBHOOK_ENDPOINTS, MEMBERS, MESSAGES_THIS_MONTH, MESSAGE_LIMIT, QUOTA_PERCENT, MARKETING_OPT_IN, OGA_USER_ID, OGA_ACCOUNT_ID` (catalogue: `src/lib/crm/attributes.ts`) |
| Lists | `OgaDesk - All users`, `OgaDesk - Use case: Developer API / Support / Sales / Marketing`, `OgaDesk - Marketing opt-in` |
| Events | `onboarding_completed, whatsapp_connected, whatsapp_disconnected, otp_template_created, template_approved, template_rejected, api_key_created, first_otp_sent, quota_80, quota_100` (plus `plan_changed` / `payment_recorded` once billing records payments) |

The app creates the missing attributes and lists itself on the first sync.

**Marketing consent.** Everyone is synced (for service and lifecycle targeting) but
`MARKETING_OPT_IN` and the `Marketing opt-in` list reflect the checkbox in onboarding
(off by default). Send marketing campaigns only to that list. An unsubscribe, spam
complaint or hard bounce in Brevo turns the flag off in the app through the webhook
below.

## Emails sent by the app

- **Welcome** (after onboarding, tailored to the use cases picked, in the user's language).
- **Usage alerts** at 80% and 100% of the monthly message allowance, to the workspace owner.

Supabase still sends the auth emails (confirm, password reset). Marketing campaigns are
sent from Brevo itself. Email text lives in the `Emails` namespace of `messages/*.json`.

## Setup

1. In Brevo: create an API key; verify the sender address or domain (SPF/DKIM) you will
   send from.
2. Set the secrets on the Worker (`npx wrangler secret put NAME --name ogadesk`):

   | Name | Value |
   | --- | --- |
   | `CRM_PROVIDER` | `brevo` |
   | `EMAIL_PROVIDER` | `brevo` |
   | `BREVO_API_KEY` | your Brevo API key |
   | `EMAIL_FROM_ADDRESS` | the verified sender, e.g. `hello@ogadesk.com` |
   | `EMAIL_FROM_NAME` | `OgaDesk` |
   | `CRM_CRON_SECRET` | any long random string |
   | `BREVO_WEBHOOK_TOKEN` | any long random string |
   | `BREVO_FOLDER_ID` | optional: a Brevo folder id for the lists |

3. Nothing else to schedule: a Cloudflare Cron Trigger (`triggers.crons` in `wrangler.jsonc`,
   every 5 minutes) runs the `scheduled` handler in `worker/custom-worker.ts`, which calls
   `/api/crm/flush` (and the automations and flows cron endpoints) through the Worker's
   own service binding, using the secrets above. No GitHub secret or external pinger.
4. In Brevo (Settings, Webhooks) add a marketing webhook for unsubscribe, spam and hard
   bounce pointing at `https://ogadesk.com/api/crm/webhooks/brevo?token=<BREVO_WEBHOOK_TOKEN>`.
5. Backfill existing users once (after the secrets are set and the app is deployed):
   `CRM_BASE_URL=https://ogadesk.com CRM_CRON_SECRET=... npm run crm:backfill`

Brevo's Events API can require a Marketing Automation plan. If it is not available,
contacts, attributes, lists and emails still work; events are marked dead in the outbox.

## How it works

Changes enqueue a job in `crm_outbox` (a user sync, an event or an email) and return at
once. Jobs are drained after the response is sent and by the 5-minute cron trigger (
`/api/crm/flush`), with retries at 1 min, 5 min, 30 min, 2 h and 12 h before a job is
marked `dead` (look at `last_error`). A contact sync reads the database when it runs, so
Brevo always gets the latest plan and usage however many changes were collapsed.

## Adding another provider

Implement `CrmProvider` and/or `EmailProvider` in `src/lib/crm/<name>.ts`, add it to
`src/lib/crm/registry.ts`, and set `CRM_PROVIDER` / `EMAIL_PROVIDER` to its name.
