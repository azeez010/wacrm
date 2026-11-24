// Markdown guides rendered at the top of the API reference (Scalar shows the
// headings as sidebar entries). Kept as plain strings so they can be reviewed
// like prose. Reference material (scopes, events) is generated from code in
// index.ts, not written here, so it cannot drift.

import { buildSetup } from '@/lib/api-keys/setup'

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

## Send one-time codes (OTP)

Use WhatsApp instead of SMS for verification codes. Two calls:

1. **One-time setup.** Create an *authentication template* (WhatsApp writes the wording, you choose the expiry). Meta usually approves it within minutes.

\`\`\`bash
curl -X POST {{BASE_URL}}/api/v1/templates \\
  -H "Authorization: Bearer $OGADESK_API_KEY" -H "Content-Type: application/json" \\
  -d '{ "name": "otp_verification", "language": "en_US", "category": "Authentication",
        "auth_options": { "code_expiration_minutes": 10 } }'
\`\`\`

Check \`GET /templates?status=APPROVED\` until it appears.

2. **Send a code** when a user signs in, then **check** what they type:

\`\`\`bash
# send (needs the otp:send scope)
curl -X POST {{BASE_URL}}/api/v1/verifications \\
  -H "Authorization: Bearer $OGADESK_API_KEY" -H "Content-Type: application/json" \\
  -d '{ "to": "+2348012345678" }'
# -> { "data": { "id": "9b1f...", "status": "pending", "expires_at": "...", ... } }

# check (needs the otp:verify scope)
curl -X POST {{BASE_URL}}/api/v1/verifications/9b1f.../check \\
  -H "Authorization: Bearer $OGADESK_API_KEY" -H "Content-Type: application/json" \\
  -d '{ "code": "482913" }'
# -> { "data": { "id": "9b1f...", "status": "approved", "attempts_remaining": 4 } }
\`\`\`

How it behaves:

- **We hold no codes.** OgaDesk generates the code and stores only a keyed hash, never the code itself. Prefer to generate it yourself? Pass \`code\` (4 to 15 letters or digits) and we only deliver it.
- **Expiry and guesses.** A code is valid for \`ttl_seconds\` (default 300, up to 900) and allows 5 wrong guesses; then the verification is \`failed\`.
- **Resends.** Sending again to the same number cancels the previous pending code.
- **Abuse protection.** At most 5 codes per number every 10 minutes (\`429 otp_rate_limited\`, with \`Retry-After\`). Add your own per-user limits too.
- **Delivery.** \`GET /verifications/{id}\` returns \`delivery.status\` (\`sent\`, \`delivered\`, \`read\`, \`failed\`) and, on failure, WhatsApp's \`error\` (for example the number is not on WhatsApp). The \`message.status_updated\` webhook carries the same \`error\` and a \`verification_id\`.
- **Several numbers?** Pass \`whatsapp_config_id\` to choose which WhatsApp number sends the code.
- **Costs.** WhatsApp bills authentication messages per message to your WhatsApp Business account.

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
| 402 | \`plan_limit\` | Your plan does not include this feature, or a count limit (API keys, webhooks, numbers) is reached |
| 402 | \`quota_exceeded\` | The plan's monthly message allowance is used up |
| 403 | \`forbidden\` | The key lacks the required scope |
| 404 | \`not_found\` | The resource does not exist in your workspace |
| 409 | \`conflict\` | The resource already exists |
| 404 | \`template_not_found\` | No authentication template with that name/language |
| 409 | \`template_not_approved\` | The template is still pending or was rejected by Meta |
| 400 | \`ambiguous_connection\` | The workspace has several WhatsApp numbers: pass \`whatsapp_config_id\` |
| 429 | \`rate_limited\` | Too many requests; see \`Retry-After\` |
| 429 | \`otp_rate_limited\` | Too many codes requested for one phone number; see \`Retry-After\` |
| 502 | \`meta_error\` | WhatsApp (Meta) rejected the request; the message contains Meta's reason |
| 500 | \`internal\` | Something went wrong on our side |
| 503 | \`unavailable\` | Temporarily unavailable; retry |

## Plans, usage and limits

Each plan includes a monthly allowance of **template messages** (one-time codes, template sends and broadcast recipients). Free-form replies inside WhatsApp's 24-hour window are free and never use the allowance. The allowance resets on the first of each month (UTC). Plans also cap the number of API keys, webhook endpoints and WhatsApp numbers, and the **public API** itself is part of the plan.

When something is over a limit the API answers \`402\` with \`plan_limit\` or \`quota_exceeded\` and a message naming your plan. \`GET /usage\` shows where you stand, so you can warn yourself before you hit a limit:

\`\`\`bash
curl {{BASE_URL}}/api/v1/usage -H "Authorization: Bearer $OGADESK_API_KEY"
# -> { "data": { "plan": "Free", "messages": { "limit": 1000, "used": 212, "remaining": 788 }, ... } }
\`\`\`

## Rate limits

Each key is limited to **120 requests per minute**. When exceeded the API returns \`429\` with \`Retry-After\` (seconds) and \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, \`X-RateLimit-Reset\` (unix seconds) headers. Back off and retry after the delay. Rate-limit headers are only sent on \`429\` responses.

## Pagination

List endpoints take \`limit\` (1 to 100, default 50) and an opaque \`cursor\`. Pass the previous response's \`meta.next_cursor\` as \`cursor\` to get the next page; \`null\` means you have reached the end. Results are newest first.

## Phone numbers

Always use international format with a leading \`+\` and the country code, e.g. \`+2348012345678\`. Spaces, dashes and brackets are ignored. Numbers without a leading \`+\` are rejected so a message can never be delivered to the wrong country.

## Webhooks

Register an HTTPS endpoint (\`POST /webhooks\`, or add one in **Settings → Webhooks**) to be told when messages arrive or change status. Each delivery is a \`POST\` with a JSON body:

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
- **Settings → Webhooks** keeps a delivery log for 14 days (status code, response and payload for every attempt) and can resend an event.
`;

// `{{BASE_URL}}` is filled in by buildOpenApiSpec, so the snippets reuse the same
// builders the Settings → API & MCP screen shows and cannot drift from it.
const mcpSnippet = (client: Parameters<typeof buildSetup>[2]) =>
  buildSetup('{{BASE_URL}}', null, client)[0].value

export const MCP_GUIDE = `
# Connect with MCP

OgaDesk has a hosted [Model Context Protocol](https://modelcontextprotocol.io) server, so AI assistants such as Claude, ChatGPT and Cursor can read and act on your workspace (contacts, conversations, forms, pipelines, broadcasts and more) in plain language, using the same API key as the REST API.

**Server URL:** \`{{BASE_URL}}/api/mcp\` (Streamable HTTP)

MCP is included on plans with the MCP feature; other plans get a \`402\` with a message saying so.

## Authentication

Create a key in **Settings → API & MCP** and send it with any of:

- \`Authorization: Bearer wacrm_live_...\`
- \`X-API-Key: wacrm_live_...\`
- \`?key=wacrm_live_...\` on the URL, for apps that only accept a single link. Treat that link like a password.

The key's **scopes decide which tools exist**. A read-only key never sees a tool that sends a message, and every call is checked again by the API. Give an assistant only what it needs; you can revoke the key at any time.

## Claude Code

\`\`\`bash
${mcpSnippet('claudecode')}
\`\`\`

## Claude Desktop

Add this to \`claude_desktop_config.json\` (it needs Node.js for \`npx\`):

\`\`\`json
${mcpSnippet('claudedesktop')}
\`\`\`

## Cursor and other clients with HTTP support

\`\`\`json
{
  "mcpServers": {
    "ogadesk": {
      "url": "{{BASE_URL}}/api/mcp",
      "headers": { "X-API-Key": "YOUR_API_KEY" }
    }
  }
}
\`\`\`

## Apps that take a single link (Claude.ai, ChatGPT connectors)

Paste this as the server URL:

\`\`\`text
${mcpSnippet('url')}
\`\`\`

## What the tools cover

Start by asking the assistant to run \`whoami\` and \`get_usage\`: they show the account, the key's scopes and your plan limits.

| Area | Examples |
| --- | --- |
| Contacts and segments | list, search, filter, create, update, import, tag |
| Inbox | list conversations and messages, send a message |
| Templates and broadcasts | create templates, send and track broadcasts |
| Forms and leads | create and edit forms, read submissions, release held leads, import or export a form |
| Pipelines and deals | build pipelines, create and move deals |
| Automations and flows | create, validate and switch on automations and chatbot flows |
| Custom data | custom fields and tables with rows |
| Developer | webhooks, API keys, verification codes (OTP) |

Anything that messages customers or deletes data is only available to keys with the matching write scope, and assistants are told to ask you before doing it. The scope table below lists every scope.
`
