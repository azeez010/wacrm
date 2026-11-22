import { describe, expect, it, vi } from 'vitest'
import {
  ValueCache,
  fetchColumnValues,
  loadTableMeta,
  parseColumnPrefs,
  readCached,
  splitSubColumnId,
  subColumnId,
  clearTableMetaCache,
} from './column-cache'

describe('ValueCache', () => {
  it('evicts the least recently used entry', () => {
    const c = new ValueCache(2)
    c.set('a', { value: '1', refLabel: null, refData: null })
    c.set('b', { value: '2', refLabel: null, refData: null })
    c.get('a') // a is now the freshest
    c.set('c', { value: '3', refLabel: null, refData: null })
    expect(c.has('a')).toBe(true)
    expect(c.has('b')).toBe(false)
    expect(c.size).toBe(2)
  })
  it('tells unknown (undefined) from known-empty (null)', () => {
    const c = new ValueCache()
    expect(c.get('x')).toBeUndefined()
    c.set('x', null)
    expect(c.get('x')).toBeNull()
  })
})

describe('fetchColumnValues', () => {
  it('makes one call, caches values and remembers empties', async () => {
    const rpc = vi.fn(async () => ({
      data: [{ contact_id: 'c1', custom_field_id: 'f1', value: 'rec1', ref_label: 'Chidi', ref_data: { age: 30 } }],
      error: null,
    }))
    const cache = new ValueCache()
    const out = await fetchColumnValues({ rpc } as never, ['c1', 'c2'], ['f1'], cache)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(out.c1.f1).toMatchObject({ refLabel: 'Chidi', refData: { age: 30 } })
    expect(cache.get(ValueCache.key('c2', 'f1'))).toBeNull()
    expect(readCached(cache, ['c1', 'c2'], ['f1']).c1.f1.value).toBe('rec1')
    expect(readCached(cache, ['c2'], ['f1'])).toEqual({})
  })
  it('skips the call when there is nothing to ask', async () => {
    const rpc = vi.fn()
    expect(await fetchColumnValues({ rpc } as never, [], ['f'], new ValueCache())).toEqual({})
    expect(rpc).not.toHaveBeenCalled()
  })
  it('throws on a database error', async () => {
    const rpc = async () => ({ data: null, error: { message: 'boom' } })
    await expect(fetchColumnValues({ rpc } as never, ['c'], ['f'], new ValueCache())).rejects.toThrow('boom')
  })
})

describe('loadTableMeta', () => {
  const makeDb = () => {
    const query = vi.fn(async () => ({
      data: [
        {
          key: 'trainers',
          name: 'Trainers',
          label_field_key: 'name',
          columns: [
            { key: 'phone', field_name: 'Phone', field_type: 'phone', field_options: {}, sort_order: 2, archived_at: null },
            { key: 'name', field_name: 'Name', field_type: 'text', field_options: {}, sort_order: 1, archived_at: null },
            { key: 'old', field_name: 'Old', field_type: 'text', field_options: {}, sort_order: 3, archived_at: 'x' },
          ],
        },
      ],
      error: null,
    }))
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.in = query
    return { db: { from: () => chain } as never, query }
  }
  it('orders columns, drops archived ones and serves the second call from memory', async () => {
    clearTableMetaCache()
    const { db, query } = makeDb()
    const a = await loadTableMeta(db, 'acc', ['trainers'])
    expect(a.trainers.columns.map((c) => c.key)).toEqual(['name', 'phone'])
    const b = await loadTableMeta(db, 'acc', ['trainers'])
    expect(b).toBe(a)
    expect(query).toHaveBeenCalledTimes(1)
    await loadTableMeta(db, 'acc', ['trainers'], true)
    expect(query).toHaveBeenCalledTimes(2)
  })
})

describe('column prefs', () => {
  it('parses old and new shapes and survives garbage', () => {
    expect(parseColumnPrefs(null)).toEqual({ hidden: [], custom: null, refCols: [] })
    expect(parseColumnPrefs('not json')).toEqual({ hidden: [], custom: null, refCols: [] })
    expect(parseColumnPrefs('{"hidden":["email"],"custom":["f1"]}')).toEqual({ hidden: ['email'], custom: ['f1'], refCols: [] })
    expect(parseColumnPrefs('{"hidden":[],"custom":null,"refCols":["f1:phone"]}').refCols).toEqual(['f1:phone'])
  })
  it('builds and splits sub-column ids', () => {
    expect(subColumnId('f1', 'phone')).toBe('f1:phone')
    expect(splitSubColumnId('f1:phone')).toEqual({ fieldId: 'f1', columnKey: 'phone' })
    expect(splitSubColumnId('nope')).toBeNull()
  })
})
