// ============================================================
// Brevo adapter: implements CrmProvider (contacts, attributes, lists, events)
// and EmailProvider (transactional email) over Brevo's v3 REST API.
//
//   https://developers.brevo.com/reference/create-contact
//   https://developers.brevo.com/reference/create-event
//
// One request = one fetch with a hard timeout and NO retry here: retrying is
// the outbox's job, and CrmError.retryable tells it whether that can help.
// ============================================================

import {
  ALL_MANAGED_LISTS,
  BUILTIN_ATTRIBUTES,
  CRM_ATTRIBUTES,
  pickKnownAttributes,
} from './attributes'
import {
  CrmError,
  type CrmContact,
  type CrmEvent,
  type CrmProvider,
  type EmailMessage,
  type EmailProvider,
} from './types'

const API = 'https://api.brevo.com/v3'
const TIMEOUT_MS = 8000
/** Brevo lists share one namespace with everything else the account does. */
const LIST_PREFIX = 'OgaDesk - '
const FOLDER_NAME = 'OgaDesk'
const SCHEMA_TTL_MS = 10 * 60 * 1000

interface Reply {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}

async function request(
  path: string,
  init: { method?: string; body?: unknown } = {},
  opts: { allow?: number[] } = {},
): Promise<Reply> {
  const key = process.env.BREVO_API_KEY
  if (!key) throw new CrmError('BREVO_API_KEY is not set', false)

  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { 'api-key': key, accept: 'application/json', 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    throw new CrmError(`Brevo request failed: ${err instanceof Error ? err.message : String(err)}`, true)
  }

  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!res.ok && !opts.allow?.includes(res.status)) {
    const msg =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : text.slice(0, 200)
    throw new CrmError(`Brevo ${res.status}: ${msg}`, res.status === 429 || res.status >= 500, res.status)
  }
  return { status: res.status, body }
}

// Per-isolate cache of what exists in Brevo (attributes, folder, list ids).
let schema: { at: number; listIds: Map<string, number> } | null = null

/** Test hook. */
export function resetBrevoSchemaCache() {
  schema = null
}

const listName = (name: string) => `${LIST_PREFIX}${name}`

async function resolveFolderId(): Promise<number> {
  const fromEnv = Number(process.env.BREVO_FOLDER_ID)
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv
  const { body } = await request('/contacts/folders?limit=50&offset=0')
  const found = (body?.folders ?? []).find((f: { name: string }) => f.name === FOLDER_NAME)
  if (found) return found.id as number
  const created = await request('/contacts/folders', { body: { name: FOLDER_NAME } })
  return created.body.id as number
}

async function ensureSchema(): Promise<Map<string, number>> {
  if (schema && Date.now() - schema.at < SCHEMA_TTL_MS) return schema.listIds

  // 1. attributes
  const { body: attrBody } = await request('/contacts/attributes')
  const have = new Set<string>((attrBody?.attributes ?? []).map((a: { name: string }) => String(a.name).toUpperCase()))
  for (const [name, type] of Object.entries(CRM_ATTRIBUTES)) {
    if (have.has(name) || (BUILTIN_ATTRIBUTES as readonly string[]).includes(name)) continue
    try {
      await request(`/contacts/attributes/normal/${name}`, { body: { type } })
    } catch (err) {
      // Created concurrently by another isolate: fine.
      if (!(err instanceof CrmError && err.status === 400 && /exist|duplicate/i.test(err.message))) throw err
    }
  }

  // 2. lists
  const listIds = new Map<string, number>()
  for (let offset = 0; ; offset += 50) {
    const { body } = await request(`/contacts/lists?limit=50&offset=${offset}`)
    const lists: Array<{ id: number; name: string }> = body?.lists ?? []
    for (const l of lists) listIds.set(l.name, l.id)
    if (lists.length < 50) break
  }
  const missing = ALL_MANAGED_LISTS.filter((n) => !listIds.has(listName(n)))
  if (missing.length > 0) {
    const folderId = await resolveFolderId()
    for (const n of missing) {
      const { body } = await request('/contacts/lists', { body: { name: listName(n), folderId } })
      listIds.set(listName(n), body.id as number)
    }
  }

  schema = { at: Date.now(), listIds }
  return listIds
}

export const brevoProvider: CrmProvider & EmailProvider = {
  name: 'brevo',

  async ensureSchema() {
    await ensureSchema()
  },

  async upsertContact(contact: CrmContact) {
    const listIds = await ensureSchema()
    const wanted = new Set(contact.lists.map((n) => listIds.get(listName(n))).filter((id): id is number => id != null))
    const unlink = ALL_MANAGED_LISTS.map((n) => listIds.get(listName(n))).filter(
      (id): id is number => id != null && !wanted.has(id),
    )

    // Brevo ignores null and mistyped values; send only what we have.
    const attributes: Record<string, string | number | boolean> = {}
    for (const [k, v] of Object.entries(pickKnownAttributes(contact.attributes))) {
      if (v !== null && v !== undefined) attributes[k] = v
    }

    // Update first (the common case): it can also REMOVE list memberships,
    // which create cannot. A 404 means the contact is new.
    const updated = await request(
      `/contacts/${encodeURIComponent(contact.email)}`,
      {
        method: 'PUT',
        body: { attributes, listIds: [...wanted], ...(unlink.length > 0 ? { unlinkListIds: unlink } : {}) },
      },
      { allow: [404] },
    )
    if (updated.status !== 404) return

    await request('/contacts', {
      body: { email: contact.email, attributes, listIds: [...wanted], updateEnabled: true },
    })
  },

  async trackEvent(event: CrmEvent) {
    await request('/events', {
      body: {
        event_name: event.name,
        ...(event.at ? { event_date: event.at } : {}),
        identifiers: { email_id: event.email },
        ...(event.properties ? { event_properties: event.properties } : {}),
      },
    })
  },

  async send(message: EmailMessage) {
    const { body } = await request('/smtp/email', {
      body: {
        sender: message.from,
        to: [message.to],
        subject: message.subject,
        // Brevo accepts one body type per request; HTML carries the design.
        htmlContent: message.html || message.text,
        ...(message.tags?.length ? { tags: message.tags } : {}),
      },
    })
    return { id: body?.messageId as string | undefined }
  },
}
