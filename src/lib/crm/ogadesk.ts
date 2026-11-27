// OgaDesk's own CRM: the OgaDesk business's workspace in this app, reached through its public API (/api/v1) with an
// API key created in that workspace and pasted in the admin console (Platform settings → Email & CRM, migration 131).
//   contact     → POST /api/v1/contacts (find-or-create by email; phone stays empty), then PATCH to set name, fields, tags
//   attributes  → contact custom fields "oga_<name>" (created once per isolate via /api/v1/custom-fields)
//   lists       → tags; tags the team added by hand are kept, only managed tags are added/removed
//   events      → an "event: <name>" tag plus the oga_last_event / oga_last_event_at fields
import { ALL_MANAGED_LISTS, BUILTIN_ATTRIBUTES, CRM_ATTRIBUTES, pickKnownAttributes, type AttributeType } from './attributes'
import { CrmError, type CrmContact, type CrmEvent, type CrmProvider } from './types'

export interface OgadeskCrmConfig {
  baseUrl: string
  apiKey: string
}

const TIMEOUT_MS = 10_000
const SCHEMA_TTL_MS = 10 * 60 * 1000
const FIELD_TYPE: Record<AttributeType, string> = { text: 'text', float: 'number', date: 'date', boolean: 'bool' }
const EXTRA_FIELDS: Record<string, AttributeType> = { LAST_EVENT: 'text', LAST_EVENT_AT: 'date' }

export const fieldKey = (attribute: string) => `oga_${attribute.toLowerCase()}`
const fieldLabel = (attribute: string) => attribute.toLowerCase().split('_').map((w, i) => (i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ')
export const eventTag = (name: string) => `event: ${name}`

type Reply = { status: number; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any

let schema: { at: number; key: string } | null = null
/** Test hook. */
export function resetOgadeskSchemaCache() {
  schema = null
}

export function ogadeskCrmProvider(cfg: OgadeskCrmConfig, f: typeof fetch = fetch): CrmProvider {
  const base = cfg.baseUrl.replace(/\/+$/, '')

  async function request(path: string, init: { method?: string; body?: unknown } = {}, allow: number[] = []): Promise<Reply> {
    let res: Response
    try {
      res = await f(`${base}/api/v1${path}`, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers: { authorization: `Bearer ${cfg.apiKey}`, accept: 'application/json', 'content-type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      throw new CrmError(`OgaDesk CRM request failed: ${err instanceof Error ? err.message : String(err)}`, true)
    }
    const text = await res.text()
    let body: unknown = null
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    if (!res.ok && !allow.includes(res.status)) {
      const b = body as { error?: { message?: string } } | null
      throw new CrmError(`OgaDesk CRM ${res.status}: ${b?.error?.message ?? String(text).slice(0, 200)}`, res.status === 429 || res.status >= 500, res.status)
    }
    return { status: res.status, body }
  }

  async function ensureSchema(): Promise<void> {
    if (schema && schema.key === cfg.apiKey && Date.now() - schema.at < SCHEMA_TTL_MS) return
    const { body } = await request('/custom-fields')
    const list: Array<{ key: string }> = Array.isArray(body?.data) ? body.data : []
    const have = new Set(list.map((x) => x.key))
    const wanted = { ...Object.fromEntries(Object.entries(CRM_ATTRIBUTES).filter(([k]) => !(BUILTIN_ATTRIBUTES as readonly string[]).includes(k))), ...EXTRA_FIELDS }
    for (const [name, type] of Object.entries(wanted)) {
      const key = fieldKey(name)
      if (have.has(key)) continue
      const r = await request('/custom-fields', { body: { key, name: `OgaDesk: ${fieldLabel(name)}`, type: FIELD_TYPE[type as AttributeType] } }, [409])
      if (r.status === 409) continue // created concurrently
    }
    schema = { at: Date.now(), key: cfg.apiKey }
  }

  /** find-or-create by email; returns the contact as the API serializes it. */
  async function upsertByEmail(email: string, name?: string | null) {
    const { body } = await request('/contacts', { body: { email, ...(name ? { name } : {}) } })
    const contact = body?.data as { id: string; name: string | null; tags?: Array<{ name: string }> } | undefined
    if (!contact?.id) throw new CrmError('OgaDesk CRM: contact create returned no id', true)
    return contact
  }

  function customFields(attrs: Record<string, string | number | boolean | null>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(attrs)) {
      if ((BUILTIN_ATTRIBUTES as readonly string[]).includes(k)) continue
      const type = (CRM_ATTRIBUTES as Record<string, AttributeType>)[k]
      // Date fields take YYYY-MM-DD; the snapshot has full timestamps.
      out[fieldKey(k)] = v === undefined || v === null ? null : type === 'date' && typeof v === 'string' ? v.slice(0, 10) : v
    }
    return out
  }

  return {
    name: 'ogadesk',

    async ensureSchema() {
      await ensureSchema()
    },

    async upsertContact(contact: CrmContact) {
      await ensureSchema()
      const attrs = pickKnownAttributes(contact.attributes)
      const name = [attrs.FIRSTNAME, attrs.LASTNAME].filter((x) => typeof x === 'string' && x).join(' ') || null
      const existing = await upsertByEmail(contact.email, name)
      // Keep tags the team added by hand; manage only ours (the CRM lists, by name).
      const managed = new Set(ALL_MANAGED_LISTS.map((n) => n.toLowerCase()))
      const current = (existing.tags ?? []).map((t) => t.name)
      const tags = [...current.filter((t) => !managed.has(t.toLowerCase())), ...contact.lists]
      await request(`/contacts/${existing.id}`, {
        method: 'PATCH',
        body: { ...(name ? { name } : {}), email: contact.email, tags: [...new Set(tags)], custom_fields: customFields(attrs) },
      })
    },

    async trackEvent(event: CrmEvent) {
      await ensureSchema()
      const existing = await upsertByEmail(event.email)
      const tags = [...new Set([...(existing.tags ?? []).map((t) => t.name), eventTag(event.name)])]
      await request(`/contacts/${existing.id}`, {
        method: 'PATCH',
        body: { tags, custom_fields: { [fieldKey('LAST_EVENT')]: event.name, [fieldKey('LAST_EVENT_AT')]: (event.at ?? new Date().toISOString()).slice(0, 10) } },
      })
    },
  }
}
