import { OTP_LIMITS } from '@/lib/otp/code'
import type { OpenApiObject, PathItems } from '../types'

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const res = (name: string) => ({ $ref: `#/components/responses/${name}` })
const json = (schema: OpenApiObject) => ({ 'application/json': { schema } })
const wrap = (item: string) => ({ type: 'object', properties: { data: ref(item) } })
const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Verification id returned when it was created.',
  schema: { type: 'string', format: 'uuid' },
}

export const verificationPaths: PathItems = {
  '/messages/{id}': {
    get: {
      tags: ['Messages'],
      operationId: 'getMessage',
      summary: 'Get a message',
      description:
        'One message with its delivery `status` and, when WhatsApp could not deliver it, the `error` (Meta code, title and details). `{id}` is the `message_id` returned when you sent it. Requires the `messages:read` scope.',
      parameters: [{ ...idParam, description: 'The `message_id` from the send response.' }],
      responses: {
        '200': { description: 'The message.', content: json(wrap('Message')) },
        '401': res('Unauthorized'),
        '403': res('Forbidden'),
        '404': res('NotFound'),
        '429': res('RateLimited'),
      },
    },
  },
  '/verifications': {
    post: {
      tags: ['Verifications'],
      operationId: 'createVerification',
      summary: 'Send a verification code',
      description:
        `Sends a one-time code to a phone number over WhatsApp using your approved **authentication template**, and starts a verification you can check later with \`POST /verifications/{id}/check\`.\n\n` +
        `- OgaDesk generates the code (or use your own with \`code\`) and stores only a hash. The code is never returned or logged.\n` +
        `- Each code expires after \`ttl_seconds\` (default ${OTP_LIMITS.ttlDefaultSeconds}) and allows ${OTP_LIMITS.maxAttempts} wrong guesses.\n` +
        `- A new code for the same number cancels the previous pending one.\n` +
        `- At most ${OTP_LIMITS.throttleMax} codes per phone number every ${OTP_LIMITS.throttleWindowSeconds / 60} minutes; beyond that the API answers \`429 otp_rate_limited\` with \`Retry-After\`.\n` +
        `- Requires the \`otp:send\` scope and an **approved** authentication template (default name \`otp_verification\`, language \`en_US\`; create it with \`POST /templates\`).`,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: ref('CreateVerificationRequest'),
            examples: {
              managed: { summary: 'We generate the code', value: { to: '+2348012345678' } },
              ownCode: { summary: 'Bring your own code', value: { to: '+2348012345678', code: '482913', ttl_seconds: 600 } },
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'The code was sent (accepted by WhatsApp).',
          content: json({
            type: 'object',
            properties: {
              data: {
                allOf: [ref('Verification'), { type: 'object', properties: { whatsapp_message_id: { type: 'string' } } }],
              },
            },
          }),
        },
        '400': { description: 'Invalid input, no WhatsApp number connected (`whatsapp_not_configured`), several numbers and no `whatsapp_config_id` (`ambiguous_connection`), or the template is not an authentication template.', content: json(ref('Error')) },
        '401': res('Unauthorized'),
        '402': res('PlanLimit'),
        '403': res('Forbidden'),
        '404': { description: 'No authentication template with that name and language (`template_not_found`).', content: json(ref('Error')) },
        '409': { description: 'The template is not approved yet (`template_not_approved`).', content: json(ref('Error')) },
        '429': {
          description: 'Too many codes for this number (`otp_rate_limited`) or the key rate limit (`rate_limited`). See `Retry-After`.',
          headers: { 'Retry-After': { schema: { type: 'integer' }, description: 'Seconds to wait.' } },
          content: json(ref('Error')),
        },
        '502': res('MetaError'),
      },
    },
  },
  '/verifications/{id}': {
    get: {
      tags: ['Verifications'],
      operationId: 'getVerification',
      summary: 'Get a verification',
      description:
        'Status of a verification, including whether the code was delivered (`delivery.status`) and WhatsApp\'s reason if it failed. Requires the `otp:verify` scope.',
      parameters: [idParam],
      responses: {
        '200': { description: 'The verification.', content: json(wrap('Verification')) },
        '401': res('Unauthorized'),
        '403': res('Forbidden'),
        '404': res('NotFound'),
        '429': res('RateLimited'),
      },
    },
  },
  '/verifications/{id}/check': {
    post: {
      tags: ['Verifications'],
      operationId: 'checkVerification',
      summary: 'Check a code',
      description:
        'Checks the code the user typed. Always `200` for an existing verification: `approved` on a match; `pending` with fewer `attempts_remaining` on a wrong code; `failed` once the guesses run out; `expired` or `canceled` otherwise. Requires the `otp:verify` scope.',
      parameters: [idParam],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['code'],
          properties: { code: { type: 'string', examples: ['482913'] } },
        }),
      },
      responses: {
        '200': { description: 'The result of the check.', content: json(wrap('VerificationCheckResult')) },
        '400': res('BadRequest'),
        '401': res('Unauthorized'),
        '403': res('Forbidden'),
        '404': res('NotFound'),
        '429': res('RateLimited'),
      },
    },
  },
}
