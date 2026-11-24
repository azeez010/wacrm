import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { CORS_HEADERS } from '@/lib/forms/public-http'
import { loadFormByPublicId } from '@/lib/forms/public-config'
import { openState } from '@/lib/forms/submit'
import { parseFormSettings, type FormRow, type FormSettings } from '@/lib/forms/types'
import { chatSecret } from './secret'
import { verifyChatToken, type ChatTokenPayload } from './token'

// ============================================================
// Shared plumbing for the public live-chat endpoints.
// ============================================================

export const CHAT_CORS: Record<string, string> = {
  ...CORS_HEADERS,
  'Access-Control-Allow-Headers': 'Content-Type, X-Chat-Token',
}

export function chatJson(body: unknown, status = 200, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...CHAT_CORS, 'Cache-Control': 'no-store', ...extra } })
}

export function chatPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CHAT_CORS })
}

/** A support-button form that is switched to live chat. */
export function isLiveChatForm(form: Pick<FormRow, 'kind' | 'settings'>): boolean {
  return form.kind === 'support' && parseFormSettings(form.settings).widget?.mode === 'live_chat'
}

export interface LoadedChatForm {
  db: SupabaseClient
  form: FormRow
  settings: FormSettings
}

/** The live-chat widget for a public id, or a ready-made error response. */
export async function loadChatForm(publicId: string): Promise<{ ok: true; value: LoadedChatForm } | { ok: false; res: NextResponse }> {
  const db = supabaseAdmin()
  const form = await loadFormByPublicId(db, publicId)
  if (!form || !isLiveChatForm(form)) return { ok: false, res: chatJson({ ok: false, error: 'not_found' }, 404) }
  const settings = parseFormSettings(form.settings)
  const open = openState(form, settings, new Date())
  if (!open.open) {
    return { ok: false, res: chatJson({ ok: false, error: open.reason }, open.reason === 'not_found' ? 404 : 403) }
  }
  return { ok: true, value: { db, form, settings } }
}

export interface ChatSession extends LoadedChatForm {
  token: ChatTokenPayload
  conversation: { id: string; contact_id: string; status: string | null }
}

/** Verify the visitor's token and that it still points at their own web-chat thread of this widget. */
export async function authorizeVisitor(request: Request, publicId: string): Promise<{ ok: true; value: ChatSession } | { ok: false; res: NextResponse }> {
  const token = await verifyChatToken(request.headers.get('x-chat-token'), await chatSecret())
  if (!token || token.role !== 'visitor') return { ok: false, res: chatJson({ ok: false, error: 'unauthorized' }, 401) }

  const loaded = await loadChatForm(publicId)
  if (!loaded.ok) return loaded
  const { db, form } = loaded.value
  if (form.account_id !== token.aid) return { ok: false, res: chatJson({ ok: false, error: 'unauthorized' }, 401) }

  const { data: conv } = await db
    .from('conversations')
    .select('id, contact_id, status, form_id')
    .eq('id', token.cid)
    .eq('account_id', token.aid)
    .eq('channel', 'web_chat')
    .maybeSingle()
  if (!conv) return { ok: false, res: chatJson({ ok: false, error: 'unauthorized' }, 401) }
  const { data: contact } = await db.from('contacts').select('web_visitor_id').eq('id', conv.contact_id).eq('account_id', token.aid).maybeSingle()
  if ((contact as { web_visitor_id?: string | null } | null)?.web_visitor_id !== token.sub) {
    return { ok: false, res: chatJson({ ok: false, error: 'unauthorized' }, 401) }
  }
  return { ok: true, value: { ...loaded.value, token, conversation: { id: conv.id as string, contact_id: conv.contact_id as string, status: (conv.status as string | null) ?? null } } }
}
