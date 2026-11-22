# Forms (lead capture)

Two kinds of form, one engine:

- **Lead form**: a hosted page (`/f/<id>`), a QR code, or an embed on your site.
- **Support button**: a floating button for your website that collects a phone number and a message, tags the lead `support`, then opens WhatsApp with the message ready to send.

Every submission becomes a **contact** (matched by phone number, so a returning lead never creates a duplicate), tagged with the form name, with its **lead source** and UTM filled in once and never overwritten.

## Share and embed

| What | How |
|---|---|
| Link / QR | Forms > open a form > Share. Add `?utm_source=...` (or use the "Add tracking" builder) per ad or poster. |
| Embed on a page | `<div data-ogadesk-form="ID"></div>` and `<script src="https://YOUR-APP/embed.js" async></script>` |
| Support button | `<script src="https://YOUR-APP/embed.js" data-widget="ID" async></script>` once, before `</body>` |
| Plain iframe | `<iframe src="https://YOUR-APP/embed/f/ID" width="100%" height="520" style="border:0"></iframe>` |

The script forwards your page's URL parameters, referrer and a visitor id into the form, so UTM and click ids (`gclid`, `fbclid`, `ttclid`) are captured even inside an iframe. It fires a `ogadesk:submitted` event on `window` so your own pixels can react:

```js
window.addEventListener('ogadesk:submitted', (e) => {
  // e.detail = { formId, whatsappUrl, redirectUrl }
  fbq && fbq('track', 'Lead');
});
```

Prefill and hidden fields: a hidden field named `ad_id` is filled from `?ad_id=42`. `?phone=`, `?name=`, `?email=` prefill the matching fields.

## Headless endpoint (your own HTML form)

```
POST https://YOUR-APP/api/public/forms/<publicId>/submit
Content-Type: application/json

{ "answers": { "phone": "08031234567", "name": "Ada" },
  "utm": { "source": "newsletter" } }
```

`answers` is keyed by the field ids of your form (`GET /api/public/forms/<publicId>` returns them). The response is the same whether or not the phone already exists. The endpoint allows cross-origin requests, is rate limited per IP, and ignores anything that is not a field on the form.

## Server to server (API key)

Scopes `forms:read`, `forms:write` (submit leads) and `forms:manage` (create, edit, publish, archive).

- `GET /api/v1/forms`
- `GET /api/v1/forms/{id}/submissions` (cursor pagination)
- `POST /api/v1/forms` (create from a template), `GET` / `PATCH` / `DELETE /api/v1/forms/{id}` (definition, edit, archive)
- `POST /api/v1/forms/{id}/submissions` with the same body as above. Runs the full pipeline (contact, tags, automations, webhook); bot checks are skipped because the caller is trusted.

## Qualification and scoring

Turn on "Qualify leads with points" in Settings. Give choice options points (and mark options that disqualify) in the field editor. Leads at or above the threshold are qualified. Below it, either save the lead with the "not qualified" tags, or refuse the entry with a message.

## Automations, webhooks, MCP

- Automation trigger **Form Submitted** (any form, or one). Answers are variables: `{{vars.name}}`, `{{vars.email}}`, `{{vars.message}}`, `{{vars.<custom field key>}}`, `{{vars.score}}`.
- Webhook event `form.submitted` with the form, contact id, qualified flag, answers and UTM.
- MCP tools (hosted and the standalone `mcp-server/`): `list_forms`, `get_form`, `list_form_submissions` (scope `forms:read`); `create_form`, `update_form`, `archive_form` (scope `forms:manage`; a new form is a draft until `update_form` sets it `active`); `submit_form_lead` (scope `forms:write`). `get_forms_reference` explains every field kind and setting.

Recipes: send `form.submitted` to a Zapier, Make or n8n webhook URL to append rows to Google Sheets or notify a Slack channel.

## Plans

`forms_max` (forms and support buttons) and `form_submissions_per_month`. Over the monthly quota leads are **held, not lost**: the visitor still sees success, and you can release them after upgrading (Results > open the lead > Release). Scoring, round-robin assignment, add-to-pipeline and the welcome message need the `forms_advanced` plan feature.

## Privacy

IP addresses are stored hashed with a daily salt; the country comes from the request. Consent text is stored with each submission and the opt-in is recorded on the contact only when the consent box was ticked. A form never overwrites data an existing contact already has, never un-blocks a blocked contact, and only accepts the field ids, options and tags defined on the form.
