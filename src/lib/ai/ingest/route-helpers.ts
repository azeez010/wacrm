import { NextResponse } from 'next/server'
import { hasMinRole } from '@/lib/auth/roles'
import type { AccountContext } from '@/lib/auth/account'
import { getT } from '@/lib/i18n/translate'
import type { SourceInputError } from './source-input'

const t = getT('Api')

/** Admins edit any source; agents edit the ones they added. */
export function canEditSource(ctx: Pick<AccountContext, 'role' | 'userId'>, createdBy: string | null): boolean {
  if (hasMinRole(ctx.role, 'admin')) return true
  return hasMinRole(ctx.role, 'agent') && createdBy === ctx.userId
}

export function sourceInputErrorResponse(error: SourceInputError) {
  const key = {
    type_invalid: 'ai.library.typeInvalid',
    name_required: 'ai.library.nameRequired',
    content_required: 'ai.library.contentRequired',
    content_too_long: 'ai.library.contentTooLong',
    pairs_required: 'ai.library.pairsRequired',
    url_invalid: 'ai.library.urlInvalid',
    file_invalid: 'ai.library.fileInvalid',
    file_empty: 'ai.library.fileEmpty',
  }[error]
  return NextResponse.json({ error: t(key), code: error }, { status: 400 })
}

/** Time a request may spend indexing before handing the rest to the cron. */
export const IN_REQUEST_BUDGET_MS = 20_000

export const SOURCE_LIST_COLUMNS =
  'id, name, type, status, error, config, sync_interval, last_synced_at, next_sync_at, doc_count, chunk_count, created_by, created_at, updated_at'
