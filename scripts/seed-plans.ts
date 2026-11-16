/**
 * Upserts plan tiers into the `plans` table. Safe to re-run in any
 * environment — editing a number here and re-running is how a tier
 * change is rolled out (no deploy).
 *
 *   node --env-file=.env.local scripts/seed-plans.ts
 *   (or: npm run seed:plans)
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * null limit = unlimited. Prices are placeholders (NGN) — tune freely.
 * Keys must exist in src/lib/billing/plans.ts to be shown/enforced.
 */
const PLANS = [
  {
    id: 'free',
    name: 'Free',
    description: 'Try it with one number and a small team.',
    price_monthly: 0,
    price_quarterly: 0,
    price_annual: 0,
    sort_order: 0,
    is_featured: false,
    limits: {
      whatsapp_connections: 1,
      seats: 2,
      contacts: 250,
      messages_per_month: 1000,
      broadcast_recipients_per_month: 0,
      broadcasts_per_month: 0,
      automations: 2,
      flows: 1,
      pipelines: 1,
      templates: 5,
      quick_replies: 10,
      api_keys: 0,
      webhook_endpoints: 0,
      ai_replies_per_month: 0,
      storage_mb: 100,
    },
    features: {
      broadcasts: false, automations: true, flows: true, ai_assistant: false,
      public_api: false, outbound_webhooks: false, csv_import: true,
      coexistence: false, custom_connection: false, priority_support: false,
    },
  },
  {
    id: 'starter',
    name: 'Starter',
    description: 'For small businesses growing their WhatsApp sales.',
    price_monthly: 15000,
    price_quarterly: 40500,
    price_annual: 144000,
    sort_order: 1,
    is_featured: false,
    limits: {
      whatsapp_connections: 2,
      seats: 5,
      contacts: 5000,
      messages_per_month: 20000,
      broadcast_recipients_per_month: 5000,
      broadcasts_per_month: 20,
      automations: 10,
      flows: 5,
      pipelines: 3,
      templates: 25,
      quick_replies: 50,
      api_keys: 2,
      webhook_endpoints: 2,
      ai_replies_per_month: 500,
      storage_mb: 2000,
    },
    features: {
      broadcasts: true, automations: true, flows: true, ai_assistant: true,
      public_api: true, outbound_webhooks: true, csv_import: true,
      coexistence: true, custom_connection: false, priority_support: false,
    },
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'High volume, many numbers, bring-your-own Meta app.',
    price_monthly: 45000,
    price_quarterly: 121500,
    price_annual: 432000,
    sort_order: 2,
    is_featured: true,
    limits: {
      whatsapp_connections: 10,
      seats: 25,
      contacts: null,
      messages_per_month: null,
      broadcast_recipients_per_month: 100000,
      broadcasts_per_month: null,
      automations: null,
      flows: null,
      pipelines: null,
      templates: null,
      quick_replies: null,
      api_keys: 20,
      webhook_endpoints: 20,
      ai_replies_per_month: 10000,
      storage_mb: 20000,
    },
    features: {
      broadcasts: true, automations: true, flows: true, ai_assistant: true,
      public_api: true, outbound_webhooks: true, csv_import: true,
      coexistence: true, custom_connection: true, priority_support: true,
    },
  },
]

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. --env-file=.env.local).')
  process.exit(1)
}

const res = await fetch(`${url}/rest/v1/plans?on_conflict=id`, {
  method: 'POST',
  headers: {
    apikey: key,
    // New-style sb_secret_ keys aren't JWTs — sending them as a Bearer
    // token is rejected; legacy service_role JWTs still need it.
    ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }),
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  },
  body: JSON.stringify(PLANS),
})
if (!res.ok) {
  console.error(`Seed failed: ${res.status} ${await res.text()}`)
  process.exit(1)
}
console.log(`Done — ${PLANS.length} plans upserted.`)

export {}
