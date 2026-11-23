// Which items the Forms list "..." menu shows for a row. Pure, so it is tested.

export type FormStatus = 'draft' | 'active' | 'paused'

export type RowAction =
  | 'edit'
  | 'share'
  | 'publish'
  | 'unpublish'
  | 'settings'
  | 'duplicate'
  | 'export'
  | 'archive'
  | 'restore'
  | 'delete'

export interface RowActionItem {
  action: RowAction
  /** False = shown but disabled (read-only role). */
  enabled: boolean
  /** A separator goes before this item. */
  separatorBefore?: boolean
  destructive?: boolean
}

export function rowActions(input: { status: FormStatus; archived: boolean; canManage: boolean; canDelete: boolean }): RowActionItem[] {
  const { status, archived, canManage, canDelete } = input
  if (archived) {
    return [
      { action: 'restore', enabled: canManage },
      { action: 'delete', enabled: canDelete, separatorBefore: true, destructive: true },
    ]
  }
  return [
    { action: 'edit', enabled: true },
    { action: 'share', enabled: true },
    { action: status === 'active' ? 'unpublish' : 'publish', enabled: canManage },
    { action: 'settings', enabled: canManage },
    { action: 'duplicate', enabled: canManage, separatorBefore: true },
    // Reading is enough to download the file.
    { action: 'export', enabled: true },
    { action: 'archive', enabled: canDelete, separatorBefore: true, destructive: true },
  ]
}
