import { NextResponse } from 'next/server'
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { AmbiguousConnectionError, NoConnectionError } from '@/lib/whatsapp/resolve-config'
import { GET as connectionGet } from '../connections/[id]/route'
import { POST as connectionsPost } from '../connections/route'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * Backward-compatible shim for the pre-multi-connection singleton API.
 *
 * Delegates to the new /api/whatsapp/connections endpoints when an
 * account has exactly one connection (the common case, and every
 * account's state before this migration). Returns 409 when an
 * account has more than one - any caller still on this path needs to
 * move to /api/whatsapp/connections and pick one explicitly.
 *
 * Kept for one release, then delete this file along with any
 * remaining callers.
 */

async function soleConnectionId(
  accountId: string,
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
) {
  const { data, error } = await supabase
    .from('whatsapp_config')
    .select('id')
    .eq('account_id', accountId)
  if (error) throw error
  if (!data || data.length === 0) throw new NoConnectionError()
  if (data.length > 1) throw new AmbiguousConnectionError()
  return data[0].id as string
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const id = await soleConnectionId(accountId, supabase)
    return connectionGet(new Request('http://internal/'), { params: Promise.resolve({ id }) })
  } catch (error) {
    if (error instanceof NoConnectionError) {
      return NextResponse.json(
        { connected: false, reason: 'no_config', message: t('whatsappConfig.noConfig') },
        { status: 200 },
      )
    }
    if (error instanceof AmbiguousConnectionError) {
      return NextResponse.json(
        { error: 'This account has more than one WhatsApp connection, use /api/whatsapp/connections.' },
        { status: 409 },
      )
    }
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error)
    }
    console.error('Error in WhatsApp config GET shim:', error)
    return NextResponse.json({ error: t('common.internalServerError') }, { status: 500 })
  }
}

export async function POST(request: Request) {
  // POST always creates a new custom connection - unambiguous even
  // with multiple existing rows, so no shim branching needed here.
  return connectionsPost(request)
}

export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const id = await soleConnectionId(accountId, supabase)
    const { error } = await supabase.from('whatsapp_config').delete().eq('id', id).eq('account_id', accountId)
    if (error) {
      console.error('Error deleting whatsapp_config:', error)
      return NextResponse.json({ error: t('whatsappConfig.deleteFailed') }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof NoConnectionError) {
      return NextResponse.json({ error: t('whatsappConfig.noConfig') }, { status: 404 })
    }
    if (error instanceof AmbiguousConnectionError) {
      return NextResponse.json(
        { error: 'This account has more than one WhatsApp connection, use /api/whatsapp/connections.' },
        { status: 409 },
      )
    }
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error)
    }
    console.error('Error in WhatsApp config DELETE shim:', error)
    return NextResponse.json({ error: t('common.internalServerError') }, { status: 500 })
  }
}
