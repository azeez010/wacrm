import type { Notification } from '@/types'

// Pure list updates shared by the Notifications page and the header bell,
// so optimistic behaviour is identical (and testable) in both.

/** Newest first, no duplicates. */
export function prependNotification(list: Notification[] | null, row: Notification): Notification[] {
  if (!list) return [row]
  return list.some((n) => n.id === row.id) ? list : [row, ...list]
}

export function mergeNotification(list: Notification[] | null, row: Notification): Notification[] | null {
  return list?.map((n) => (n.id === row.id ? { ...n, ...row } : n)) ?? list
}

export function removeNotification(list: Notification[] | null, id: string | undefined): Notification[] | null {
  return list?.filter((n) => n.id !== id) ?? list
}

export function markOneRead(list: Notification[] | null, id: string, at: string): Notification[] | null {
  return list?.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: at } : n)) ?? list
}

export function markAllReadLocal(list: Notification[] | null, at: string): Notification[] | null {
  return list?.map((n) => (n.read_at ? n : { ...n, read_at: at })) ?? list
}

export function unreadIdsOf(list: Notification[] | null): string[] {
  return list?.filter((n) => !n.read_at).map((n) => n.id) ?? []
}
