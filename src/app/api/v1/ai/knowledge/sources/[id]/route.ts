// DELETE /api/v1/ai/knowledge/sources/{id} (ai:write) - remove a source everywhere (documents, chunks, agent links,
// and an uploaded file).
import { requireApiKey } from '@/lib/auth/api-context'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { deleteSource } from '@/lib/ai/service'
import { aiResult } from '@/lib/api/v1/ai'
import { toApiErrorResponse } from '@/lib/api/v1/respond'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'ai:write')
    const r = await deleteSource(ctx.supabase, ctx.accountId, (await params).id)
    if (r.ok && r.data.type === 'file') {
      const path = (r.data.config as { storagePath?: unknown } | null)?.storagePath
      if (typeof path === 'string' && path.startsWith(`account-${ctx.accountId}/`)) {
        await supabaseAdmin().storage.from('knowledge-files').remove([path]).catch(() => undefined)
      }
    }
    return r.ok ? aiResult({ ok: true, data: { id: r.data.id, deleted: true } }) : aiResult(r)
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
