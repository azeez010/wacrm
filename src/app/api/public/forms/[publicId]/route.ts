import { supabaseAdmin } from '@/lib/automations/admin-client'
import { buildPublicConfig, loadFormByPublicId } from '@/lib/forms/public-config'
import { corsJson, corsPreflight } from '@/lib/forms/public-http'
import { openState } from '@/lib/forms/submit'
import { parseFormSettings } from '@/lib/forms/types'

export function OPTIONS() {
  return corsPreflight()
}

/** The public definition of a form (used by the embed script and headless clients). */
export async function GET(_req: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const db = supabaseAdmin()
  const form = await loadFormByPublicId(db, publicId)
  if (!form) return corsJson({ error: 'not_found' }, 404)
  const state = openState(form, parseFormSettings(form.settings), new Date())
  if (!state.open) return corsJson({ error: state.reason }, state.reason === 'not_found' ? 404 : 410)
  return corsJson(await buildPublicConfig(db, form), 200, { 'Cache-Control': 'public, max-age=30, s-maxage=30' })
}
