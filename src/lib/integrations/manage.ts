import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { assertFeature, assertWithinLimit } from '@/lib/billing/entitlements'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { assertPublicHttps } from '@/lib/ai/tools/guarded-fetch'
import { discoverMcpTools, type McpTool } from '@/lib/ai/tools/executors/mcp'
import { PAYSTACK_TOOLS, verifyPaystackKey } from '@/lib/ai/tools/executors/paystack'

// Settings → Integrations: create / update / discover. Used by the /api/integrations routes (admins only, writes with
// the service-role client because the encrypted `secrets` column is not writable or readable from the browser).
// Secrets are write-only: the UI only ever sees `secret_hints` (e.g. "••••1234").

export type IntegrationKind = 'mcp' | 'http' | 'google_calendar' | 'paystack'

export class IntegrationInputError extends Error {
  readonly status = 400 as const
  constructor(message: string) {
    super(message)
    this.name = 'IntegrationInputError'
  }
}

export const INTEGRATION_PUBLIC_COLUMNS =
  'id, kind, name, status, config, secret_hints, last_ok_at, last_error_at, last_error, created_at, updated_at'
export const TOOL_PUBLIC_COLUMNS =
  'id, integration_id, name, title, description, input_schema, kind, enabled, auto_approve, source, config, updated_at'

const name = z.string().trim().min(1, 'Give it a name.').max(80)
const headerName = z.string().trim().regex(/^[A-Za-z0-9-]{1,64}$/, 'Header names use letters, digits and dashes.')

export const FIELD_TYPES = ['string', 'number', 'integer', 'boolean'] as const
const field = z.object({
  name: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]{0,39}$/, 'Field names use letters, digits and underscores.'),
  type: z.enum(FIELD_TYPES).default('string'),
  description: z.string().trim().max(300).default(''),
  required: z.boolean().default(false),
})
export type HttpField = z.infer<typeof field>

export const httpToolSchema = z.object({
  name: z.string().trim().regex(/^[A-Za-z0-9_-]{1,48}$/, 'Tool names use letters, digits, - and _ (no spaces).'),
  description: z.string().trim().min(5, 'Describe when the AI should use it.').max(1000),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: z.string().trim().url('Enter a full https:// URL.'),
  fields: z.array(field).max(20).default([]),
  kind: z.enum(['read', 'action']),
})
export type HttpToolInput = z.infer<typeof httpToolSchema>

export const createSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('mcp'),
    name,
    url: z.string().trim().url('Enter the MCP server URL.'),
    token: z.string().trim().max(4000).optional(),
    header_name: headerName.optional(),
  }),
  z.object({
    kind: z.literal('http'),
    name,
    headers: z.array(z.object({ name: headerName, value: z.string().max(4000) })).max(10).default([]),
    tools: z.array(httpToolSchema).max(20).default([]),
  }),
  z.object({
    kind: z.literal('paystack'),
    name,
    secret_key: z.string().trim().regex(/^sk_(test|live)_[A-Za-z0-9]{10,}$/, 'Paste your Paystack secret key (sk_live_… or sk_test_…).'),
    currency: z.string().trim().regex(/^[A-Z]{3}$/).default('NGN'),
    business_name: z.string().trim().max(80).optional(),
  }),
])
export type CreateInput = z.infer<typeof createSchema>

export const updateSchema = z.object({
  name: name.optional(),
  status: z.enum(['connected', 'disabled']).optional(),
  url: z.string().trim().url().optional(),
  token: z.string().trim().max(4000).optional(),
  header_name: headerName.nullable().optional(),
  headers: z.array(z.object({ name: headerName, value: z.string().max(4000) })).max(10).optional(),
  secret_key: z.string().trim().regex(/^sk_(test|live)_[A-Za-z0-9]{10,}$/).optional(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  business_name: z.string().trim().max(80).optional(),
})
export type UpdateInput = z.infer<typeof updateSchema>

export const toolPatchSchema = z.object({
  enabled: z.boolean().optional(),
  auto_approve: z.boolean().optional(),
  kind: z.enum(['read', 'action']).optional(),
  description: z.string().trim().max(2000).optional(),
})

export function firstIssue(err: z.ZodError): string {
  const i = err.issues[0]
  return i ? i.message : 'Invalid input.'
}

export function hint(v: string): string {
  return v.length <= 4 ? '••••' : `••••${v.slice(-4)}`
}

export function readSecrets(enc: string | null): Record<string, string> {
  if (!enc) return {}
  try {
    const v = JSON.parse(decrypt(enc)) as unknown
    return v && typeof v === 'object' ? (v as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function sealSecrets(s: Record<string, string>): { secrets: string | null; secret_hints: Record<string, string> } {
  const clean = Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === 'string' && v.length > 0))
  return {
    secrets: Object.keys(clean).length ? encrypt(JSON.stringify(clean)) : null,
    secret_hints: Object.fromEntries(Object.entries(clean).map(([k, v]) => [k, hint(v)])),
  }
}

/** JSON Schema for an HTTP action's declared fields. */
export function fieldsToSchema(fields: HttpField[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const f of fields) properties[f.name] = { type: f.type, ...(f.description ? { description: f.description } : {}) }
  const required = fields.filter((f) => f.required).map((f) => f.name)
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

export function schemaToFields(schema: Record<string, unknown> | null | undefined): HttpField[] {
  const props = (schema?.properties ?? {}) as Record<string, { type?: string; description?: string }>
  const req = new Set(Array.isArray(schema?.required) ? (schema!.required as string[]) : [])
  return Object.entries(props).map(([n, p]) => ({
    name: n,
    type: (FIELD_TYPES as readonly string[]).includes(p.type ?? '') ? (p.type as HttpField['type']) : 'string',
    description: p.description ?? '',
    required: req.has(n),
  }))
}

export function httpToolRow(t: HttpToolInput, headerNames: string[]) {
  return {
    name: t.name,
    title: t.name.replace(/[_-]+/g, ' '),
    description: t.description,
    input_schema: fieldsToSchema(t.fields),
    kind: t.kind,
    source: 'defined' as const,
    config: { method: t.method, url: t.url, headerNames },
  }
}

/** MCP tools → rows. read only when the server says readOnlyHint; anything else is treated as an action (safe default). */
export function mcpToolRows(tools: McpTool[]) {
  return tools
    .filter((t) => /^[A-Za-z0-9_.-]{1,64}$/.test(t.name))
    .slice(0, 64)
    .map((t) => ({
      name: t.name,
      title: t.title ?? t.annotations?.title ?? null,
      description: (t.description ?? '').slice(0, 2000),
      input_schema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} },
      kind: t.annotations?.readOnlyHint === true ? ('read' as const) : ('action' as const),
      source: 'discovered' as const,
      config: {},
    }))
}

export function paystackToolRows() {
  return PAYSTACK_TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, input_schema: t.inputSchema, kind: t.kind, source: 'builtin' as const, config: {} }))
}

type ToolRowInput = ReturnType<typeof mcpToolRows>[number] | ReturnType<typeof httpToolRow> | ReturnType<typeof paystackToolRows>[number]

/** The plan must include AI tools, and the business must be under its integrations limit. */
export async function assertCanAddIntegration(db: SupabaseClient, accountId: string) {
  await assertFeature(db, accountId, 'ai_tools')
  const { count } = await db.from('integrations').select('id', { count: 'exact', head: true }).eq('account_id', accountId)
  await assertWithinLimit(db, accountId, 'integrations_max', count ?? 0)
}

export interface Deps {
  fetch?: typeof fetch
  check?: (u: string) => Promise<URL>
}

function mcpConn(url: string, token: string | undefined, header: string | null | undefined, deps: Deps) {
  return { url, token: header ? undefined : token, headers: header && token ? { [header]: token } : {}, fetch: deps.fetch, check: deps.check }
}

/** Validates the connection (MCP handshake, Paystack key) and returns what to insert. Throws IntegrationInputError. */
export async function prepareCreate(input: CreateInput, deps: Deps = {}) {
  switch (input.kind) {
    case 'mcp': {
      await (deps.check ?? assertPublicHttps)(input.url).catch((e: Error) => { throw new IntegrationInputError(e.message) })
      let found
      try {
        found = await discoverMcpTools(mcpConn(input.url, input.token, input.header_name, deps))
      } catch (e) {
        throw new IntegrationInputError(`Could not connect: ${e instanceof Error ? e.message : 'unknown error'}`)
      }
      return {
        row: { kind: 'mcp' as const, name: input.name, config: { url: input.url, header_name: input.header_name ?? null, server_name: found.serverName }, ...sealSecrets(input.token ? { token: input.token } : {}) },
        tools: mcpToolRows(found.tools) as ToolRowInput[],
      }
    }
    case 'http': {
      for (const t of input.tools) await (deps.check ?? assertPublicHttps)(t.url).catch((e: Error) => { throw new IntegrationInputError(`${t.name}: ${e.message}`) })
      const headerNames = input.headers.map((h) => h.name)
      return {
        row: { kind: 'http' as const, name: input.name, config: { header_names: headerNames }, ...sealSecrets(Object.fromEntries(input.headers.map((h) => [`header:${h.name}`, h.value]))) },
        tools: input.tools.map((t) => httpToolRow(t, headerNames)) as ToolRowInput[],
      }
    }
    case 'paystack': {
      try {
        await verifyPaystackKey(input.secret_key, deps.fetch)
      } catch (e) {
        throw new IntegrationInputError(e instanceof Error ? e.message : 'Paystack rejected the key.')
      }
      return {
        row: { kind: 'paystack' as const, name: input.name, config: { currency: input.currency, business_name: input.business_name ?? null, mode: input.secret_key.startsWith('sk_test_') ? 'test' : 'live' }, ...sealSecrets({ secret_key: input.secret_key }) },
        tools: paystackToolRows() as ToolRowInput[],
      }
    }
  }
}

export async function insertTools(db: SupabaseClient, accountId: string, integrationId: string, tools: ToolRowInput[]) {
  if (!tools.length) return
  const { error } = await db.from('integration_tools').insert(tools.map((t) => ({ ...t, account_id: accountId, integration_id: integrationId })))
  if (error) throw new Error(error.message)
}

/**
 * Re-list an MCP server's tools: new ones are added (disabled read/action split as the server says), removed ones are
 * deleted, existing ones keep the business's enabled / auto-approve / kind choices but get the new description + schema.
 */
export async function rediscoverMcp(db: SupabaseClient, integration: { id: string; account_id: string; config: Record<string, unknown>; secrets: string | null }, deps: Deps = {}) {
  const sec = readSecrets(integration.secrets)
  const found = await discoverMcpTools(mcpConn(String(integration.config.url ?? ''), sec.token, integration.config.header_name as string | null, deps))
  const rows = mcpToolRows(found.tools)
  const { data: existing } = await db.from('integration_tools').select('id, name').eq('integration_id', integration.id)
  const have = new Map((existing ?? []).map((r) => [r.name as string, r.id as string]))
  const next = new Set(rows.map((r) => r.name))
  const added = rows.filter((r) => !have.has(r.name))
  for (const r of rows.filter((x) => have.has(x.name))) {
    await db.from('integration_tools').update({ title: r.title, description: r.description, input_schema: r.input_schema }).eq('id', have.get(r.name)!)
  }
  await insertTools(db, integration.account_id, integration.id, added)
  const removed = [...have.entries()].filter(([n]) => !next.has(n)).map(([, id]) => id)
  if (removed.length) await db.from('integration_tools').delete().in('id', removed)
  await db.from('integrations').update({ status: 'connected', last_ok_at: new Date().toISOString(), last_error: null, config: { ...integration.config, server_name: found.serverName } }).eq('id', integration.id)
  return { added: added.length, removed: removed.length, total: rows.length }
}

/** Applies an update; re-validates the connection when the URL / token / key changes. */
export async function prepareUpdate(
  current: { kind: IntegrationKind; config: Record<string, unknown>; secrets: string | null },
  input: UpdateInput,
  deps: Deps = {},
): Promise<Record<string, unknown>> {
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.status !== undefined) patch.status = input.status
  const sec = readSecrets(current.secrets)
  let secretsChanged = false
  const config = { ...current.config }

  if (current.kind === 'mcp') {
    if (input.url !== undefined) {
      await (deps.check ?? assertPublicHttps)(input.url).catch((e: Error) => { throw new IntegrationInputError(e.message) })
      config.url = input.url
    }
    if (input.header_name !== undefined) config.header_name = input.header_name
    if (input.token !== undefined) {
      sec.token = input.token
      secretsChanged = true
    }
    if (input.url !== undefined || input.token !== undefined || input.header_name !== undefined) {
      try {
        await discoverMcpTools(mcpConn(String(config.url), sec.token, config.header_name as string | null, deps))
      } catch (e) {
        throw new IntegrationInputError(`Could not connect: ${e instanceof Error ? e.message : 'unknown error'}`)
      }
      patch.status = input.status ?? 'connected'
      patch.last_error = null
    }
  }
  if (current.kind === 'http' && input.headers !== undefined) {
    for (const k of Object.keys(sec)) if (k.startsWith('header:')) delete sec[k]
    for (const h of input.headers) {
      // An empty value keeps the saved one (the UI never sees it).
      const prev = readSecrets(current.secrets)[`header:${h.name}`]
      sec[`header:${h.name}`] = h.value || prev || ''
    }
    config.header_names = input.headers.map((h) => h.name)
    secretsChanged = true
  }
  if (current.kind === 'paystack') {
    if (input.secret_key !== undefined) {
      try {
        await verifyPaystackKey(input.secret_key, deps.fetch)
      } catch (e) {
        throw new IntegrationInputError(e instanceof Error ? e.message : 'Paystack rejected the key.')
      }
      sec.secret_key = input.secret_key
      config.mode = input.secret_key.startsWith('sk_test_') ? 'test' : 'live'
      secretsChanged = true
      patch.status = input.status ?? 'connected'
    }
    if (input.currency !== undefined) config.currency = input.currency
    if (input.business_name !== undefined) config.business_name = input.business_name
  }
  patch.config = config
  if (secretsChanged) Object.assign(patch, sealSecrets(sec))
  return patch
}
