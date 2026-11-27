// ============================================================
// Shared contact logic for the public API (v1) contact endpoints.
//
// Kept out of the route files so `GET/POST /api/v1/contacts` and
// `GET/PATCH /api/v1/contacts/{id}` share one serializer, one
// find-or-create (built on the same `findExistingContact` dedupe the
// webhook and send path use), and one tag-sync routine.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils';
import { loadContactCustomFields } from '@/lib/custom-fields/contact-values';

/** Row select that embeds the contact's tags for serialization. */
export const CONTACT_SELECT = '*, contact_tags(tags(*))';

export interface ApiContact {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  company: string | null;
  avatar_url: string | null;
  /** First-touch lead source and UTM (set once, never overwritten). */
  lead_source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  /** Where the contact first came from: the page they were on, the form they used, and when we first saw them. */
  source_referrer: string | null;
  source_form_id: string | null;
  first_seen_at: string | null;
  /** Consent captured by a form (when, where, and the text they agreed to). */
  opt_in_at: string | null;
  opt_in_source: string | null;
  /** Passive WhatsApp reachability from Meta's delivery results: 'active', 'unreachable' (error 131026) or null (never seen). */
  wa_status: 'active' | 'unreachable' | null;
  wa_status_at: string | null;
  /** True when the contact is blocked: no message of any kind is sent to them. */
  blocked: boolean;
  blocked_reason: 'manual' | 'opt_out' | 'import' | 'api' | null;
  blocked_at: string | null;
  /** True when a lower plan archived the contact: kept, but no broadcasts, automations, flows or AI replies. */
  archived_by_plan: boolean;
  tags: { id: string; name: string; color: string }[];
  /** Typed custom field values keyed by field key. Filled by `attachCustomFields`. */
  custom_fields?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Thrown by the helpers below; routes map `.status`/`.message`. */
export class ContactError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ContactError';
    this.status = status;
  }
}

type RawTagJoin = { tags: { id: string; name: string; color: string } | null };

/** Flatten a `CONTACT_SELECT` row into the public contact shape. */
export function serializeContact(row: Record<string, unknown>): ApiContact {
  const joins = (row.contact_tags as RawTagJoin[] | undefined) ?? [];
  return {
    id: row.id as string,
    phone: row.phone as string,
    name: (row.name as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    company: (row.company as string | null) ?? null,
    avatar_url: (row.avatar_url as string | null) ?? null,
    lead_source: (row.lead_source as string | null) ?? null,
    utm_source: (row.utm_source as string | null) ?? null,
    utm_medium: (row.utm_medium as string | null) ?? null,
    utm_campaign: (row.utm_campaign as string | null) ?? null,
    utm_term: (row.utm_term as string | null) ?? null,
    utm_content: (row.utm_content as string | null) ?? null,
    source_referrer: (row.source_referrer as string | null) ?? null,
    source_form_id: (row.source_form_id as string | null) ?? null,
    first_seen_at: (row.first_seen_at as string | null) ?? null,
    opt_in_at: (row.opt_in_at as string | null) ?? null,
    opt_in_source: (row.opt_in_source as string | null) ?? null,
    wa_status: (row.wa_status as ApiContact['wa_status']) ?? null,
    wa_status_at: (row.wa_status_at as string | null) ?? null,
    blocked: Boolean(row.blocked_at),
    blocked_reason: (row.blocked_reason as ApiContact['blocked_reason']) ?? null,
    blocked_at: (row.blocked_at as string | null) ?? null,
    archived_by_plan: Boolean(row.plan_archived_at),
    tags: joins
      .map((j) => j.tags)
      .filter((t): t is NonNullable<RawTagJoin['tags']> => t != null)
      .map((t) => ({ id: t.id, name: t.name, color: t.color })),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/**
 * Resolve the audit `user_id` for API-created rows - the SINGLE source
 * of truth used by every public-API write (contacts, messages,
 * broadcasts, resolve-conversation), so the same key's writes are
 * always attributed to the same human. API callers have no logged-in
 * user, so - like the inbound webhook - we attribute writes to the
 * **WhatsApp config owner** (the webhook's own convention). Contacts
 * can be created before WhatsApp is connected, so we fall back to the
 * account owner when there's no config yet.
 */
export async function resolveAuditUserId(
  db: SupabaseClient,
  accountId: string
): Promise<string> {
  const { data: config } = await db
    .from('whatsapp_config')
    .select('user_id')
    .eq('account_id', accountId)
    .maybeSingle();
  const configOwner = config?.user_id as string | undefined;
  if (configOwner) return configOwner;

  const { data: account } = await db
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle();
  const owner = account?.owner_user_id as string | undefined;
  if (!owner) {
    throw new ContactError('Account owner could not be resolved', 500);
  }
  return owner;
}

export interface ContactInput {
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  /** First-touch lead source for a NEW contact (default 'API'). */
  leadSource?: string | null;
}

const EMAIL_ONLY_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Find (by email, case-insensitive) or create a contact that has an email but no phone yet. Used when an integration
 * only knows the person's email (for example OgaDesk's own CRM sync of signups). The phone stays empty until known.
 */
export async function findOrCreateContactByEmail(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  input: Omit<ContactInput, 'phone'> & { email: string }
): Promise<{ id: string; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_ONLY_RE.test(email) || email.length > 254) {
    throw new ContactError("'email' must be a valid email address", 400);
  }
  const like = email.replace(/[\\%_]/g, '\\$&');
  const { data: found } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .ilike('email', like)
    .order('created_at', { ascending: true })
    .limit(1);
  if (found && found.length > 0) return { id: (found[0] as { id: string }).id, created: false };

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      phone: '',
      name: input.name ?? email,
      email,
      company: input.company ?? null,
      lead_source: input.leadSource ?? 'API',
      first_seen_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !created) {
    console.error('[api/v1/contacts] create by email error:', error);
    throw new ContactError('Failed to create contact', 500);
  }
  return { id: created.id, created: true };
}

/**
 * Find (by fuzzy phone match) or create a contact in `accountId`.
 * Returns the contact id and whether it was created. Reuses the shared
 * `findExistingContact` dedupe + unique-violation race backstop so an
 * API-created contact is indistinguishable from a webhook-created one.
 */
export async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  input: ContactInput
): Promise<{ id: string; created: boolean }> {
  // Raw integrator input: the leading `+` is required so the country
  // code is explicit. A national-format number ("4155551212") would
  // otherwise be persisted and then misdelivered on every later send
  // (issue #586).
  const sanitized = parseInternationalPhone(input.phone);
  if (!sanitized) {
    throw new ContactError(
      "'phone' must be an international phone number with a leading + and country code (e.g. +14155550123)",
      400
    );
  }

  const existing = await findExistingContact(db, accountId, sanitized);
  if (existing) return { id: existing.id, created: false };

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      phone: sanitized,
      name: input.name ?? sanitized,
      email: input.email ?? null,
      company: input.company ?? null,
      lead_source: input.leadSource ?? 'API',
      first_seen_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !created) {
    // Lost a race against a concurrent create - the unique index
    // rejected the duplicate. Re-resolve to the winner.
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(db, accountId, sanitized);
      if (raced) return { id: raced.id, created: false };
    }
    console.error('[api/v1/contacts] create error:', error);
    throw new ContactError('Failed to create contact', 500);
  }

  return { id: created.id, created: true };
}

/**
 * Replace a contact's tags to exactly match `tagNames` (case-
 * insensitive; missing tags are created). Pass `[]` to clear all tags.
 * Reuses `resolveImportTagIds` so API and CSV-import tag handling stay
 * consistent.
 */
export async function setContactTags(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  contactId: string,
  tagNames: string[]
): Promise<void> {
  await syncContactTags(db, accountId, auditUserId, contactId, tagNames, true);
}

export async function addContactTags(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  contactId: string,
  tagNames: string[]
): Promise<void> {
  await syncContactTags(db, accountId, auditUserId, contactId, tagNames, false);
}

async function syncContactTags(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  contactId: string,
  tagNames: string[],
  removeUnrequested: boolean
): Promise<void> {
  const { tagIdByKey } = await resolveImportTagIds(db, {
    accountId,
    userId: auditUserId,
    tagNames,
    canCreateTags: true,
  });
  // Same normalization `resolveImportTagIds` applies to `tagNames`
  // (trim, lowercase, skip empty) so every requested name resolves.
  const desired = new Set<string>();
  for (const raw of tagNames) {
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    const tagId = tagIdByKey.get(key);
    if (tagId) desired.add(tagId);
  }

  // Diff against the current joins rather than delete-all-then-insert:
  // a diff only touches tags that actually change, so a mid-operation
  // failure can never wipe tags that were meant to stay. Every write
  // is error-checked and surfaced as a ContactError (→ 500) instead of
  // being swallowed behind a misleading 200.
  const { data: current, error: readErr } = await db
    .from('contact_tags')
    .select('tag_id')
    .eq('contact_id', contactId);
  if (readErr) {
    throw new ContactError('Failed to read contact tags', 500);
  }
  const existing = new Set(
    (current ?? []).map((r) => r.tag_id as string)
  );

  const toAdd = [...desired].filter((id) => !existing.has(id));
  const toRemove = removeUnrequested
    ? [...existing].filter((id) => !desired.has(id))
    : [];

  if (toRemove.length > 0) {
    const { error } = await db
      .from('contact_tags')
      .delete()
      .eq('contact_id', contactId)
      .in('tag_id', toRemove);
    if (error) throw new ContactError('Failed to update contact tags', 500);
  }
  if (toAdd.length > 0) {
    for (const tagId of toAdd) {
      try {
        await addContactTagAndDispatch({
          db,
          accountId,
          contactId,
          tagId,
        });
      } catch (error) {
        console.error('[api/v1/contacts] tag add failed:', error);
        throw new ContactError('Failed to update contact tags', 500);
      }
    }
  }
}

/** Fetch + serialize a single contact scoped to the account, or null. */
export async function getContactById(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<ApiContact | null> {
  const { data, error } = await db
    .from('contacts')
    .select(CONTACT_SELECT)
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  const [withFields] = await attachCustomFields(db, accountId, [
    serializeContact(data as Record<string, unknown>),
  ]);
  return withFields;
}

/** Add `custom_fields` ({ key: typed value }) to serialized contacts. */
export async function attachCustomFields(
  db: SupabaseClient,
  accountId: string,
  contacts: ApiContact[]
): Promise<ApiContact[]> {
  const values = await loadContactCustomFields(
    db,
    accountId,
    contacts.map((c) => c.id)
  );
  return contacts.map((c) => ({ ...c, custom_fields: values[c.id] ?? {} }));
}

export { contactSearchFilter } from '@/lib/contacts/search-filter';
