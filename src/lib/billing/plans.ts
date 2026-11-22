/**
 * Catalogue of limit / feature keys (labels for the landing page and
 * settings UI). The VALUES live in the `plans` table - edit
 * scripts/seed-plans.ts and run `npm run seed:plans`. Unknown keys in
 * the DB are ignored, so adding a limit = add it here + seed + enforce.
 * null = unlimited.
 */
export const LIMIT_DEFS = {
  whatsapp_connections: 'WhatsApp numbers',
  seats: 'Team members',
  contacts: 'Contacts',
  messages_per_month: 'Messages / month',
  broadcast_recipients_per_month: 'Broadcast recipients / month',
  broadcasts_per_month: 'Broadcasts / month',
  automations: 'Automations',
  flows: 'Chatbot flows',
  pipelines: 'Pipelines',
  templates: 'Message templates',
  quick_replies: 'Quick replies',
  api_keys: 'API keys',
  webhook_endpoints: 'Outbound webhooks',
  ai_replies_per_month: 'AI replies / month',
  storage_mb: 'Media storage (MB)',
  custom_fields_max: 'Custom contact fields',
  custom_tables_max: 'Custom tables',
  custom_records_max: 'Custom table rows',
} as const

export const FEATURE_DEFS = {
  broadcasts: 'Broadcast campaigns',
  automations: 'Automations',
  flows: 'Chatbot flow builder',
  ai_assistant: 'AI reply assistant',
  public_api: 'Public API',
  mcp: 'Claude / MCP connection',
  outbound_webhooks: 'Outbound webhooks',
  csv_import: 'CSV import / export',
  coexistence: 'Use your existing WhatsApp Business app number',
  custom_connection: 'Bring your own Meta app',
  priority_support: 'Priority support',
  custom_fields: 'Custom fields, segments and tables',
} as const

/**
 * Features that predate their catalogue entry. A plan row that has never
 * been re-seeded has no key for them, and a missing key normally means
 * "locked" - for these it means "included" so existing accounts keep
 * working until the plan is explicitly set to false.
 */
export const DEFAULT_ON_FEATURES: readonly FeatureKey[] = ['custom_fields']

export type LimitKey = keyof typeof LIMIT_DEFS
export type FeatureKey = keyof typeof FEATURE_DEFS

export type PlanRow = {
  id: string
  name: string
  description: string | null
  currency: string
  price_monthly: number
  price_quarterly: number
  price_annual: number
  limits: Partial<Record<LimitKey, number | null>>
  features: Partial<Record<FeatureKey, boolean>>
  is_featured: boolean
  sort_order: number
}
