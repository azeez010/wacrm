import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllInChunks, fetchAllPages } from '@/lib/supabase/paged-query';
import type { Contact } from '@/types';
import type { FilterGroup } from '@/lib/segments/types';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export type AudienceType = 'all' | 'tags' | 'custom_field' | 'segment' | 'csv';

export interface CsvAudienceRow {
  phone: string;
  name?: string;
}

export interface AudienceConfig {
  type: AudienceType;
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: CsvAudienceRow[];
  excludeTagIds?: string[];
  /** A saved segment, re-evaluated at send time (dynamic, never a snapshot). */
  segmentId?: string;
  /** Ad hoc filter (API / MCP); wins over `segmentId` when both are set. */
  filter?: FilterGroup;
}

/**
 * The one shape persisted into `broadcasts.audience_filter` by every
 * writer (draft save and send), so both paths round-trip identically.
 * CSV rows are intentionally not stored.
 */
export function serializeAudience(audience: AudienceConfig): Record<string, unknown> {
  return {
    type: audience.type,
    tagIds: audience.tagIds,
    customField: audience.customField,
    excludeTagIds: audience.excludeTagIds,
    segmentId: audience.segmentId,
    filter: audience.filter,
  };
}

/** Read a stored `audience_filter` back into an AudienceConfig (tolerates old rows). */
export function parseStoredAudience(raw: unknown): AudienceConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const types: AudienceType[] = ['all', 'tags', 'custom_field', 'segment', 'csv'];
  const type = types.includes(r.type as AudienceType) ? (r.type as AudienceType) : 'all';
  return {
    type,
    tagIds: Array.isArray(r.tagIds) ? (r.tagIds as string[]) : undefined,
    customField: (r.customField as CustomFieldFilter | undefined) ?? undefined,
    excludeTagIds: Array.isArray(r.excludeTagIds) ? (r.excludeTagIds as string[]) : undefined,
    segmentId: typeof r.segmentId === 'string' ? r.segmentId : undefined,
    filter: (r.filter as FilterGroup | undefined) ?? undefined,
  };
}

async function withContext<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch ${label}: ${message}`);
  }
}

export function fetchTaggedContactIds(
  db: SupabaseClient,
  tagIds: readonly string[],
): Promise<Set<string>> {
  return withContext('contact tags', async () => {
    const rows = await fetchAllInChunks<{ contact_id: string }, string>(
      tagIds,
      (slice, from, to) =>
        db
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', slice)
          .order('id')
          .range(from, to),
    );
    return new Set(rows.map((row) => row.contact_id));
  });
}

export function fetchCustomFieldContactIds(
  db: SupabaseClient,
  filter: CustomFieldFilter,
): Promise<Set<string>> {
  return withContext('custom field matches', async () => {
    const { fieldId, operator, value } = filter;
    const rows = await fetchAllPages<{ contact_id: string }>((from, to) => {
      let query = db
        .from('contact_custom_values')
        .select('contact_id')
        .eq('custom_field_id', fieldId);
      if (operator === 'is') query = query.eq('value', value);
      else if (operator === 'is_not') query = query.neq('value', value);
      else query = query.ilike('value', `%${value}%`);
      return query.order('id').range(from, to);
    });
    return new Set(rows.map((row) => row.contact_id));
  });
}

/** Resolve a segment's saved filter (null when it no longer exists). */
export async function loadSegmentFilter(
  db: SupabaseClient,
  segmentId: string,
  accountId?: string,
): Promise<FilterGroup | null> {
  let q = db.from('segments').select('filter').eq('id', segmentId);
  if (accountId) q = q.eq('account_id', accountId);
  const { data } = await q.maybeSingle();
  return (data?.filter as FilterGroup | undefined) ?? null;
}

/** The effective filter of a segment / ad hoc audience, or null when unresolved. */
async function audienceFilter(
  db: SupabaseClient,
  audience: AudienceConfig,
  accountId?: string,
): Promise<FilterGroup | null> {
  if (audience.filter) return audience.filter;
  if (audience.segmentId) return loadSegmentFilter(db, audience.segmentId, accountId);
  return null;
}

/**
 * Every contact matching a filter, paged through `filter_contacts`.
 * Service-role callers must pass `accountId` (the service role bypasses RLS).
 */
export function fetchContactsByFilter(
  db: SupabaseClient,
  filter: FilterGroup,
  accountId?: string,
): Promise<Contact[]> {
  return withContext('segment contacts', async () => {
    const PAGE = 1000;
    const out: Contact[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await db.rpc('filter_contacts', {
        p_filter: filter,
        p_search: null,
        p_limit: PAGE,
        p_offset: offset,
        p_sort_field: null,
        p_sort_dir: 'asc',
        p_account_id: accountId ?? null,
      });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { contact: Contact }[];
      out.push(...rows.map((r) => r.contact));
      if (rows.length < PAGE) break;
    }
    return out;
  });
}

export function fetchContactsByIds(
  db: SupabaseClient,
  ids: readonly string[],
): Promise<Contact[]> {
  return withContext('contacts', () =>
    fetchAllInChunks<Contact, string>(ids, (slice, from, to) =>
      db.from('contacts').select('*').in('id', slice).order('id').range(from, to),
    ),
  );
}

export function fetchAllContacts(db: SupabaseClient): Promise<Contact[]> {
  return withContext('contacts', () =>
    fetchAllPages<Contact>((from, to) =>
      db.from('contacts').select('*').order('id').range(from, to),
    ),
  );
}

async function fetchExcludedIds(
  db: SupabaseClient,
  audience: AudienceConfig,
): Promise<Set<string>> {
  if (!audience.excludeTagIds || audience.excludeTagIds.length === 0) {
    return new Set();
  }
  return fetchTaggedContactIds(db, audience.excludeTagIds);
}

function hasCustomFieldFilter(
  audience: AudienceConfig,
): audience is AudienceConfig & { customField: CustomFieldFilter } {
  return Boolean(audience.customField?.fieldId);
}

async function fetchAudienceContactIds(
  db: SupabaseClient,
  audience: AudienceConfig,
): Promise<Set<string> | null> {
  if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
    return fetchTaggedContactIds(db, audience.tagIds);
  }
  if (audience.type === 'custom_field' && hasCustomFieldFilter(audience)) {
    return fetchCustomFieldContactIds(db, audience.customField);
  }
  return null;
}

export async function resolveAudienceContacts(
  db: SupabaseClient,
  audience: AudienceConfig,
  resolveCsv: (rows: CsvAudienceRow[]) => Promise<Contact[]>,
  opts: { accountId?: string } = {},
): Promise<Contact[]> {
  const excluded = await fetchExcludedIds(db, audience);
  const keep = (contact: Contact) => !excluded.has(contact.id);

  if (audience.type === 'segment') {
    const filter = await audienceFilter(db, audience, opts.accountId);
    if (!filter) throw new Error('The selected segment no longer exists');
    return (await fetchContactsByFilter(db, filter, opts.accountId)).filter(keep);
  }

  if (audience.type === 'all') {
    return (await fetchAllContacts(db)).filter(keep);
  }
  if (audience.type === 'csv') {
    if (!audience.csvContacts) return [];
    return (await resolveCsv(audience.csvContacts)).filter(keep);
  }

  const ids = await fetchAudienceContactIds(db, audience);
  if (!ids) return [];
  const wanted = [...ids].filter((id) => !excluded.has(id));
  if (wanted.length === 0) return [];
  return fetchContactsByIds(db, wanted);
}

export async function countAudience(
  db: SupabaseClient,
  audience: AudienceConfig,
  opts: { accountId?: string } = {},
): Promise<number | null> {
  if (audience.type === 'segment') {
    const filter = await audienceFilter(db, audience, opts.accountId);
    if (!filter) return null;
    const { data, error } = await db.rpc('count_contacts', {
      p_filter: filter,
      p_search: null,
      p_account_id: opts.accountId ?? null,
    });
    if (error) throw new Error(`Failed to count segment: ${error.message}`);
    const total = Number(data ?? 0);
    if (!audience.excludeTagIds || audience.excludeTagIds.length === 0) return total;
    // Exclusions: subtract matches that carry an excluded tag.
    const matched = await fetchContactsByFilter(db, filter, opts.accountId);
    const excluded = await fetchExcludedIds(db, audience);
    return matched.filter((c) => !excluded.has(c.id)).length;
  }

  if (audience.type === 'csv') {
    return audience.csvContacts && audience.csvContacts.length > 0
      ? audience.csvContacts.length
      : null;
  }

  if (audience.type === 'all') {
    const { count, error } = await db
      .from('contacts')
      .select('id', { count: 'exact', head: true });
    if (error) throw new Error(`Failed to count contacts: ${error.message}`);
    const total = count ?? 0;
    const excluded = await fetchExcludedIds(db, audience);
    return Math.max(0, total - excluded.size);
  }

  if (audience.type === 'custom_field' && !audience.customField?.value) {
    return null;
  }

  const ids = await fetchAudienceContactIds(db, audience);
  if (!ids) return null;
  const excluded = await fetchExcludedIds(db, audience);
  let size = 0;
  for (const id of ids) if (!excluded.has(id)) size++;
  return size;
}
