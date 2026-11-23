import { describe, expect, it } from 'vitest'

import { rowActions } from './row-actions'

const names = (i: ReturnType<typeof rowActions>) => i.map((x) => x.action)

describe('forms list row actions', () => {
  it('a live form offers Unpublish, a draft or paused one Publish', () => {
    expect(names(rowActions({ status: 'active', archived: false, canManage: true, canDelete: true }))).toEqual(['edit', 'share', 'unpublish', 'settings', 'duplicate', 'export', 'archive'])
    expect(names(rowActions({ status: 'draft', archived: false, canManage: true, canDelete: true }))).toContain('publish')
    expect(names(rowActions({ status: 'paused', archived: false, canManage: true, canDelete: true }))).toContain('publish')
  })
  it('a viewer can open and share but not change anything', () => {
    const items = rowActions({ status: 'active', archived: false, canManage: false, canDelete: false })
    const enabled = Object.fromEntries(items.map((i) => [i.action, i.enabled]))
    expect(enabled).toMatchObject({ edit: true, share: true, unpublish: false, settings: false, duplicate: false, export: true, archive: false })
  })
  it('an agent can manage but not archive; an admin can', () => {
    const agent = rowActions({ status: 'active', archived: false, canManage: true, canDelete: false })
    expect(agent.find((i) => i.action === 'archive')?.enabled).toBe(false)
    expect(agent.find((i) => i.action === 'unpublish')?.enabled).toBe(true)
  })
  it('archived forms only offer Restore and Delete permanently (admin)', () => {
    const items = rowActions({ status: 'paused', archived: true, canManage: true, canDelete: false })
    expect(names(items)).toEqual(['restore', 'delete'])
    expect(items[0].enabled).toBe(true)
    expect(items[1]).toMatchObject({ enabled: false, destructive: true })
  })
  it('destructive items are separated and marked', () => {
    const items = rowActions({ status: 'active', archived: false, canManage: true, canDelete: true })
    expect(items.find((i) => i.action === 'archive')).toMatchObject({ destructive: true, separatorBefore: true })
  })
})
