import { describe, expect, it } from 'vitest'
import type { Notification } from '@/types'
import {
  markAllReadLocal,
  markOneRead,
  mergeNotification,
  prependNotification,
  removeNotification,
  unreadIdsOf,
} from './list-state'

const n = (id: string, read_at: string | null = null) =>
  ({ id, read_at, type: 'conversation_assigned', created_at: '2026-01-01T00:00:00Z' }) as unknown as Notification

describe('notification list state', () => {
  it('prepends new rows once', () => {
    expect(prependNotification(null, n('a')).map((x) => x.id)).toEqual(['a'])
    const list = [n('a')]
    expect(prependNotification(list, n('b')).map((x) => x.id)).toEqual(['b', 'a'])
    expect(prependNotification(list, n('a'))).toBe(list)
  })
  it('merges updates and removes deletes', () => {
    const list = [n('a'), n('b')]
    expect(mergeNotification(list, { ...n('a'), read_at: 'x' })!.find((x) => x.id === 'a')!.read_at).toBe('x')
    expect(removeNotification(list, 'a')!.map((x) => x.id)).toEqual(['b'])
    expect(removeNotification(null, 'a')).toBeNull()
  })
  it('marks one or all read without touching already-read rows', () => {
    const list = [n('a'), n('b', 'earlier')]
    expect(markOneRead(list, 'a', 'now')![0].read_at).toBe('now')
    expect(markOneRead(list, 'b', 'now')![1].read_at).toBe('earlier')
    const all = markAllReadLocal(list, 'now')!
    expect(all.map((x) => x.read_at)).toEqual(['now', 'earlier'])
    expect(unreadIdsOf(list)).toEqual(['a'])
    expect(unreadIdsOf(null)).toEqual([])
  })
})
