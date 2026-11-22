import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  countAudience,
  parseStoredAudience,
  resolveAudienceContacts,
  serializeAudience,
  type AudienceConfig,
} from './broadcast-audience';
import type { Contact } from '@/types';

const MAX_ROWS = 1000;
const MAX_IN_CLAUSE_CHARS = 8000;

type Row = Record<string, unknown>;

interface Request {
  table: string;
  inValues: number;
  head: boolean;
}

function cappedPostgrest(tables: Record<string, Row[]>) {
  const requests: Request[] = [];

  const db = {
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      let orderBy: string | null = null;
      let window: [number, number] | null = null;
      let head = false;
      let count = false;
      let inChars = 0;
      let inValues = 0;

      const builder = {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          head = Boolean(opts?.head);
          count = opts?.count === 'exact';
          return builder;
        },
        eq(col: string, value: unknown) {
          filters.push((row) => row[col] === value);
          return builder;
        },
        neq(col: string, value: unknown) {
          filters.push((row) => row[col] !== value);
          return builder;
        },
        ilike(col: string, pattern: string) {
          const needle = pattern.replace(/%/g, '').toLowerCase();
          filters.push((row) =>
            String(row[col] ?? '').toLowerCase().includes(needle),
          );
          return builder;
        },
        in(col: string, values: readonly unknown[]) {
          inValues += values.length;
          inChars += values.reduce<number>(
            (sum, v) => sum + encodeURIComponent(String(v)).length + 1,
            0,
          );
          const allowed = new Set(values);
          filters.push((row) => allowed.has(row[col]));
          return builder;
        },
        order(col: string) {
          orderBy = col;
          return builder;
        },
        range(from: number, to: number) {
          window = [from, to];
          return builder;
        },
        then<R>(resolve: (result: unknown) => R) {
          requests.push({ table, inValues, head });
          if (inChars > MAX_IN_CLAUSE_CHARS) {
            return Promise.resolve(
              resolve({ data: null, count: null, error: { message: 'URI Too Long' } }),
            );
          }
          let rows = (tables[table] ?? []).filter((row) =>
            filters.every((f) => f(row)),
          );
          const total = rows.length;
          if (head) {
            return Promise.resolve(
              resolve({ data: null, count: count ? total : null, error: null }),
            );
          }
          if (orderBy) {
            const key = orderBy;
            rows = [...rows].sort((a, b) =>
              String(a[key]).localeCompare(String(b[key])),
            );
          }
          const [from, to] = window ?? [0, Number.MAX_SAFE_INTEGER];
          const page = rows.slice(from, Math.min(to + 1, from + MAX_ROWS));
          return Promise.resolve(
            resolve({ data: page, count: count ? total : null, error: null }),
          );
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;

  return { db, requests };
}

function uuid(prefix: string, i: number) {
  return `${prefix}${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

function contacts(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: uuid('c', i),
    phone: `+1555${String(i).padStart(7, '0')}`,
  }));
}

function tagRows(contactRows: Row[], tagId: string, prefix: string): Row[] {
  return contactRows.map((c, i) => ({
    id: uuid(prefix, i),
    contact_id: c.id,
    tag_id: tagId,
  }));
}

const noCsv = async (): Promise<Contact[]> => [];

describe('resolveAudienceContacts', () => {
  it('returns every contact for "all" beyond the 1000-row cap', async () => {
    const { db } = cappedPostgrest({ contacts: contacts(2812) });
    const result = await resolveAudienceContacts(db, { type: 'all' }, noCsv);
    expect(result).toHaveLength(2812);
    expect(new Set(result.map((c) => c.id)).size).toBe(2812);
  });

  it('resolves a tag audience with more than 1000 tag rows', async () => {
    const all = contacts(3000);
    const tagged = all.slice(0, 2812);
    const { db, requests } = cappedPostgrest({
      contacts: all,
      contact_tags: tagRows(tagged, 'tag-big', 't'),
    });

    const result = await resolveAudienceContacts(
      db,
      { type: 'tags', tagIds: ['tag-big'] },
      noCsv,
    );

    expect(result).toHaveLength(2812);
    expect(new Set(result.map((c) => c.id))).toEqual(
      new Set(tagged.map((c) => c.id)),
    );
    for (const r of requests) expect(r.inValues).toBeLessThanOrEqual(100);
  });

  it('resolves a few hundred tagged contacts without an oversized IN clause', async () => {
    const all = contacts(780);
    const { db } = cappedPostgrest({
      contacts: all,
      contact_tags: tagRows(all, 'tag-780', 't'),
    });

    const result = await resolveAudienceContacts(
      db,
      { type: 'tags', tagIds: ['tag-780'] },
      noCsv,
    );

    expect(result).toHaveLength(780);
  });

  it('de-duplicates contacts carrying several selected tags', async () => {
    const all = contacts(1500);
    const { db } = cappedPostgrest({
      contacts: all,
      contact_tags: [
        ...tagRows(all, 'tag-a', 'a'),
        ...tagRows(all.slice(0, 900), 'tag-b', 'b'),
      ],
    });

    const result = await resolveAudienceContacts(
      db,
      { type: 'tags', tagIds: ['tag-a', 'tag-b'] },
      noCsv,
    );

    expect(result).toHaveLength(1500);
  });

  it('applies an exclude list larger than 1000 contacts', async () => {
    const all = contacts(2600);
    const optedOut = all.slice(0, 1700);
    const { db } = cappedPostgrest({
      contacts: all,
      contact_tags: tagRows(optedOut, 'tag-optout', 'x'),
    });

    const result = await resolveAudienceContacts(
      db,
      { type: 'all', excludeTagIds: ['tag-optout'] },
      noCsv,
    );

    const optedOutIds = new Set(optedOut.map((c) => c.id));
    expect(result).toHaveLength(900);
    expect(result.some((c) => optedOutIds.has(c.id))).toBe(false);
  });

  it('subtracts a large exclude list from a large tag audience', async () => {
    const all = contacts(2500);
    const { db } = cappedPostgrest({
      contacts: all,
      contact_tags: [
        ...tagRows(all, 'tag-customers', 'k'),
        ...tagRows(all.slice(1000, 2200), 'tag-optout', 'x'),
      ],
    });

    const result = await resolveAudienceContacts(
      db,
      { type: 'tags', tagIds: ['tag-customers'], excludeTagIds: ['tag-optout'] },
      noCsv,
    );

    expect(result).toHaveLength(1300);
    const excluded = new Set(all.slice(1000, 2200).map((c) => c.id));
    expect(result.some((c) => excluded.has(c.id))).toBe(false);
  });

  it('resolves a custom-field audience beyond the cap', async () => {
    const all = contacts(1800);
    const { db } = cappedPostgrest({
      contacts: all,
      contact_custom_values: all.map((c, i) => ({
        id: uuid('v', i),
        contact_id: c.id,
        custom_field_id: 'field-city',
        value: i % 3 === 0 ? 'Vilnius' : 'Kaunas',
      })),
    });

    const result = await resolveAudienceContacts(
      db,
      {
        type: 'custom_field',
        customField: { fieldId: 'field-city', operator: 'is', value: 'Kaunas' },
      },
      noCsv,
    );

    expect(result).toHaveLength(1200);
  });

  it('applies excludes to CSV-resolved contacts', async () => {
    const all = contacts(3);
    const { db } = cappedPostgrest({
      contacts: all,
      contact_tags: tagRows(all.slice(0, 1), 'tag-optout', 'x'),
    });

    const result = await resolveAudienceContacts(
      db,
      {
        type: 'csv',
        csvContacts: [{ phone: '+1' }],
        excludeTagIds: ['tag-optout'],
      },
      async () => all as unknown as Contact[],
    );

    expect(result.map((c) => c.id)).toEqual([all[1].id, all[2].id]);
  });

  it('returns nothing for an empty tag selection', async () => {
    const { db, requests } = cappedPostgrest({ contacts: contacts(5) });
    expect(
      await resolveAudienceContacts(db, { type: 'tags', tagIds: [] }, noCsv),
    ).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it('surfaces a query failure instead of resolving an empty audience', async () => {
    const db = {
      from: () => {
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'in', 'order', 'range', 'eq']) b[m] = () => b;
        b.then = (resolve: (r: unknown) => unknown) =>
          Promise.resolve(resolve({ data: null, error: { message: 'denied' } }));
        return b;
      },
    } as unknown as SupabaseClient;

    await expect(
      resolveAudienceContacts(db, { type: 'tags', tagIds: ['t'] }, noCsv),
    ).rejects.toThrow('Failed to fetch contact tags: denied');
  });
});

describe('countAudience', () => {
  it('counts "all" with a head request', async () => {
    const { db, requests } = cappedPostgrest({ contacts: contacts(2812) });
    expect(await countAudience(db, { type: 'all' })).toBe(2812);
    expect(requests).toEqual([{ table: 'contacts', inValues: 0, head: true }]);
  });

  it('subtracts a large exclude list from "all"', async () => {
    const all = contacts(2600);
    const { db } = cappedPostgrest({
      contacts: all,
      contact_tags: tagRows(all.slice(0, 1700), 'tag-optout', 'x'),
    });
    expect(
      await countAudience(db, { type: 'all', excludeTagIds: ['tag-optout'] }),
    ).toBe(900);
  });

  it('counts a tag audience beyond the cap, minus excludes', async () => {
    const all = contacts(2812);
    const { db } = cappedPostgrest({
      contacts: all,
      contact_tags: [
        ...tagRows(all, 'tag-big', 't'),
        ...tagRows(all.slice(0, 1100), 'tag-optout', 'x'),
      ],
    });
    expect(await countAudience(db, { type: 'tags', tagIds: ['tag-big'] })).toBe(
      2812,
    );
    expect(
      await countAudience(db, {
        type: 'tags',
        tagIds: ['tag-big'],
        excludeTagIds: ['tag-optout'],
      }),
    ).toBe(1712);
  });

  it('counts a custom-field audience', async () => {
    const all = contacts(1500);
    const { db } = cappedPostgrest({
      contact_custom_values: all.map((c, i) => ({
        id: uuid('v', i),
        contact_id: c.id,
        custom_field_id: 'f',
        value: 'Gold tier',
      })),
    });
    expect(
      await countAudience(db, {
        type: 'custom_field',
        customField: { fieldId: 'f', operator: 'contains', value: 'gold' },
      }),
    ).toBe(1500);
  });

  it('counts CSV rows without a query', async () => {
    const { db, requests } = cappedPostgrest({});
    const audience: AudienceConfig = {
      type: 'csv',
      csvContacts: [{ phone: '+1' }, { phone: '+2' }],
    };
    expect(await countAudience(db, audience)).toBe(2);
    expect(requests).toHaveLength(0);
  });

  it('returns null for a partially configured audience', async () => {
    const { db } = cappedPostgrest({});
    expect(await countAudience(db, { type: 'tags', tagIds: [] })).toBeNull();
    expect(
      await countAudience(db, {
        type: 'custom_field',
        customField: { fieldId: 'f', operator: 'is', value: '' },
      }),
    ).toBeNull();
    expect(await countAudience(db, { type: 'csv' })).toBeNull();
  });
});

describe('audience persistence', () => {
  it('round-trips every audience field through one shape', () => {
    const a = {
      type: 'segment' as const,
      segmentId: 's1',
      excludeTagIds: ['t1'],
      tagIds: undefined,
    }
    const stored = serializeAudience({ ...a, csvContacts: [{ phone: '+1' }] })
    expect(stored).not.toHaveProperty('csvContacts')
    expect(parseStoredAudience(stored)).toMatchObject({ type: 'segment', segmentId: 's1', excludeTagIds: ['t1'] })
  })
  it('tolerates legacy and malformed rows', () => {
    expect(parseStoredAudience({ type: 'tags', tagIds: ['a'] })).toMatchObject({ type: 'tags', tagIds: ['a'] })
    expect(parseStoredAudience(null).type).toBe('all')
    expect(parseStoredAudience({ type: 'bogus' }).type).toBe('all')
  })
})

function fakeSegmentDb(opts: { filter?: unknown; pages?: unknown[][]; count?: number }) {
  const pages = [...(opts.pages ?? [])]
  const rpc = vi.fn(async (name: string) => {
    if (name === 'count_contacts') return { data: opts.count ?? 0, error: null }
    return { data: (pages.shift() ?? []).map((c) => ({ contact: c })), error: null }
  })
  const db = {
    rpc,
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.maybeSingle = async () => ({ data: table === 'segments' && opts.filter ? { filter: opts.filter } : null })
      return chain
    },
  }
  return { db: db as never, rpc }
}

describe('segment audience', () => {
  const filter = { version: 1, op: 'and', rules: [] }
  it('resolves contacts through filter_contacts with the account guard', async () => {
    const { db, rpc } = fakeSegmentDb({ filter, pages: [[{ id: 'c1' }, { id: 'c2' }]] })
    const out = await resolveAudienceContacts(db, { type: 'segment', segmentId: 's1' }, async () => [], { accountId: 'acc' })
    expect(out.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(rpc).toHaveBeenCalledWith('filter_contacts', expect.objectContaining({ p_account_id: 'acc' }))
  })
  it('fails loudly when the segment was deleted', async () => {
    const { db } = fakeSegmentDb({})
    await expect(
      resolveAudienceContacts(db, { type: 'segment', segmentId: 'gone' }, async () => []),
    ).rejects.toThrow(/no longer exists/)
  })
  it('counts via count_contacts and returns null for an unresolved segment', async () => {
    const { db } = fakeSegmentDb({ filter, count: 42 })
    expect(await countAudience(db, { type: 'segment', segmentId: 's1' })).toBe(42)
    const { db: empty } = fakeSegmentDb({})
    expect(await countAudience(empty, { type: 'segment', segmentId: 'x' })).toBeNull()
  })
})

describe('explicit contacts audience (bulk "Send template")', () => {
  it('stores only the count, never the ids', () => {
    const stored = serializeAudience({ type: 'contacts', contactIds: ['a', 'b', 'c'] });
    expect(stored).toMatchObject({ type: 'contacts', contactCount: 3 });
    expect(JSON.stringify(stored)).not.toContain('"a"');
    expect(parseStoredAudience(stored).type).toBe('contacts');
  });
  it('counts the picked ids without a database call', async () => {
    const db = {} as never;
    expect(await countAudience(db, { type: 'contacts', contactIds: ['a', 'b'] })).toBe(2);
    expect(await countAudience(db, { type: 'contacts', contactIds: [] })).toBeNull();
  });
  it('resolves nothing for an empty selection', async () => {
    const out = await resolveAudienceContacts({} as never, { type: 'contacts', contactIds: [] }, async () => []);
    expect(out).toEqual([]);
  });
});
