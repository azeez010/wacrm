import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { setContactBlocked } from '@/lib/contacts/block-write';
import { getT } from '@/lib/i18n/translate';

const t = getT('Api');

async function handle(
  params: Promise<{ id: string }>,
  blocked: boolean
): Promise<NextResponse> {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;
    const result = await setContactBlocked(ctx.supabase, {
      accountId: ctx.accountId,
      contactId,
      blocked,
      reason: 'manual',
      userId: ctx.userId,
    });
    if (!result.found) {
      return NextResponse.json({ error: t('contacts.notFound') }, { status: 404 });
    }
    return NextResponse.json({ ok: true, changed: result.changed });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Block a contact. Idempotent: `changed: false` when already blocked. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(params, true);
}

/** Unblock a contact. Idempotent: `changed: false` when not blocked. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(params, false);
}
