// ============================================================
// POST /api/v1/verifications - send a verification code over WhatsApp.
//
// Scope `otp:send`. Body:
//   { "to": "+2348012345678",        // required, international format
//     "code": "482913",              // optional: bring your own code
//     "code_length": 6,              // 4-8, when we generate it (default 6)
//     "ttl_seconds": 300,            // 60-900 (default 300)
//     "whatsapp_config_id": "<uuid>",// needed with several WhatsApp numbers
//     "template": { "name": "otp_verification", "language": "en_US" },
//     "metadata": { ... } }          // echoed back, up to 1 KB
//
// Response 201: { data: { id, status: "pending", to, expires_at, ... } }
// The code is never stored or returned: check it with
// POST /verifications/{id}/check.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context'
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import { SendMessageError } from '@/lib/whatsapp/send-message'
import { createVerification } from '@/lib/otp/verifications'

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'otp:send')
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return fail('bad_request', 'Request body must be a JSON object', 400)
    }
    const { verification, whatsappMessageId } = await createVerification(ctx.supabase, ctx.accountId, {
      to: body.to,
      code: body.code,
      codeLength: body.code_length,
      ttlSeconds: body.ttl_seconds,
      whatsappConfigId: body.whatsapp_config_id,
      template: body.template && typeof body.template === 'object' ? (body.template as Record<string, unknown>) : null,
      metadata: body.metadata,
    })
    return ok({ ...verification, whatsapp_message_id: whatsappMessageId }, 201)
  } catch (err) {
    if (err instanceof SendMessageError) return fail(err.code, err.message, err.status)
    return toApiErrorResponse(err)
  }
}
