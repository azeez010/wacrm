// Markdown guides rendered at the top of the API reference (Scalar shows the
// headings as sidebar entries). Kept as plain strings so they can be reviewed
// like prose. Reference material (scopes, events) is generated from code in
// index.ts, not written here, so it cannot drift.

export const INTRODUCTION = `
# Introduction

The OgaDesk API lets your backend send WhatsApp messages and templates, read delivery status and receive events, using your own WhatsApp Business number.

**Base URL:** \`{{BASE_URL}}/api/v1\`

All requests and responses are JSON. Every successful response is wrapped as \`{ "data": ... }\`; list responses add \`"meta": { "next_cursor": ... }\`; errors are \`{ "error": { "code", "message" } }\`.

## Quickstart: send your first message

1. In the dashboard, connect a WhatsApp number (**Settings → WhatsApp**).
2. Create an API key (**Settings → API keys**) with the \`messages:send\` scope. The key is shown once, so copy it.
3. Send a message:

\`\`\`bash
curl -X POST {{BASE_URL}}/api/v1/messages \\
  -H "Authorization: Bearer $OGADESK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+2348012345678",
    "type": "template",
    "template": { "name": "hello_world", "language": "en_US" }
  }'
\`\`\`

A message to a number that has not written to you in the last 24 hours must be an approved **template**. Free-form \`text\` works inside the 24-hour customer-service window.

## Authentication

Send your key in the \`Authorization\` header:

\`\`\`
Authorization: Bearer wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
\`\`\`

Keys are created by workspace admins and carry **scopes**. A key can only call the endpoints its scopes allow; a missing scope returns \`403 forbidden\`. A missing, malformed, revoked or expired key returns \`401 unauthorized\`. Keep keys on your server; never ship them in a browser or mobile app (the API does not send CORS headers).

## Errors

Errors always look like this:

\`\`\`json
{ "error": { "code": "bad_request", "message": "'to' is required" } }
\`\`\`

Branch on \`code\`, not on \`message\` (messages may be reworded).

| HTTP | code | Meaning |
| --- | --- | --- |
| 400 | \`bad_request\` | Invalid input |
| 400 | \`whatsapp_not_configured\` | The workspace has no connected WhatsApp number |
| 401 | \`unauthorized\` | Missing, malformed, unknown, revoked or expired key |
| 402 | \`plan_limit\` | Your plan does not include this or its limit is reached |
| 403 | \`forbidden\` | The key lacks the required scope |
| 404 | \`not_found\` | The resource does not exist in your workspace |
| 409 | \`conflict\` | The resource already exists |
| 429 | \`rate_limited\` | Too many requests; see \`Retry-After\` |
| 502 | \`meta_error\` | WhatsApp (Meta) rejected the request; the message contains Meta's reason |
| 500 | \`internal\` | Something went wrong on our side |
| 503 | \`unavailable\` | Temporarily unavailable; retry |

## Rate limits

Each key is limited to **120 requests per minute**. When exceeded the API returns \`429\` with \`Retry-After\` (seconds) and \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, \`X-RateLimit-Reset\` (unix seconds) headers. Back off and retry after the delay. Rate-limit headers are only sent on \`429\` responses.

## Pagination

List endpoints take \`limit\` (1 to 100, default 50) and an opaque \`cursor\`. Pass the previous response's \`meta.next_cursor\` as \`cursor\` to get the next page; \`null\` means you have reached the end. Results are newest first.

## Phone numbers

Always use international format with a leading \`+\` and the country code, e.g. \`+2348012345678\`. Spaces, dashes and brackets are ignored. Numbers without a leading \`+\` are rejected so a message can never be delivered to the wrong country.

## Webhooks

Register an HTTPS endpoint (\`POST /webhooks\`) to be told when messages arrive or change status. Each delivery is a \`POST\` with a JSON body:

\`\`\`json
{
  "id": "5c1c9a52-...",
  "event": "message.status_updated",
  "occurred_at": "2026-11-20T10:15:00.000Z",
  "account_id": "...",
  "data": { "whatsapp_message_id": "wamid....", "conversation_id": "...", "status": "delivered" }
}
\`\`\`

Headers: \`X-Wacrm-Event\`, \`X-Wacrm-Webhook-Id\` (the endpoint id) and \`X-Wacrm-Signature\`.

### Verify the signature

\`X-Wacrm-Signature\` is \`t=<unix seconds>,v1=<hex>\` where \`v1\` is \`HMAC-SHA256(secret, "<t>.<raw body>")\`, using the \`whsec_...\` secret returned when you created the endpoint. Compute it over the **raw** request body, compare in constant time, and reject timestamps older than 5 minutes.

\`\`\`js
import crypto from 'node:crypto';

export function verify(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!parts.t || !parts.v1 || age > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(\`\${parts.t}.\${rawBody}\`).digest('hex');
  const a = Buffer.from(parts.v1);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
\`\`\`

\`\`\`python
import hmac, hashlib, time

def verify(raw_body: bytes, header: str, secret: str, tolerance=300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    if abs(time.time() - int(parts["t"])) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{parts['t']}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(parts["v1"], expected)
\`\`\`

### Delivery behaviour

- Respond with any \`2xx\` within **5 seconds**. Redirects are not followed.
- Each event is attempted **once** (no automatic retries). If you need certainty, also poll the message status endpoints.
- After **15 consecutive failures** the endpoint is disabled; re-enable it with \`PATCH /webhooks/{id}\`.
- The body \`id\` identifies the event; use it to de-duplicate.
`;
