# Meta App Review & Tech Provider checklist (Embedded Signup + coexistence)

What to prepare and paste into the Meta developer dashboard so OgaDesk can be approved
to onboard other businesses through **Embedded Signup** (new number) and **coexistence**
(existing WhatsApp Business app number). Replace `https://wacrm.dataslid.com.ng` with
your production domain if it changes — every URL below hangs off it.

> Meta's dashboard and review rules change. Treat this as a checklist of what reviewers
> ask for, and confirm field names against the current Meta docs.

## 0. Use a separate Meta app from Kena

A Meta app has **one** webhook callback per product. Kena's app already points its WhatsApp
webhook at Kena's backend, so OgaDesk can't share it. Create a **new Meta app of type
"Business"** in the **same Business Portfolio** that is already verified for Kena — business
verification carries over, but the new app still needs its own App Review.

## 1. App settings → Basic

| Field | Value |
| --- | --- |
| Display name | OgaDesk |
| App icon (1024×1024) | `OgaDesk_Green_Brand_Kit/02_Favicons_App/ogadesk-app-icon-1024.png` |
| Privacy Policy URL | `https://wacrm.dataslid.com.ng/privacy` |
| Terms of Service URL | `https://wacrm.dataslid.com.ng/terms` |
| User data deletion | **Data deletion callback URL:** `https://wacrm.dataslid.com.ng/api/meta/data-deletion` (alternatively an instructions URL: `https://wacrm.dataslid.com.ng/data-deletion`) |
| App domains | `wacrm.dataslid.com.ng` |
| Category | Business and pages |
| Contact email | the support address shown on the policy pages |

Facebook Login for Business / Login settings:

- **Deauthorize callback URL:** `https://wacrm.dataslid.com.ng/api/meta/deauthorize`
- **Allowed domains for the JavaScript SDK:** `https://wacrm.dataslid.com.ng`
- Valid OAuth redirect URIs: not needed for the JS-SDK popup flow, add the domain if the dashboard asks.

Both callbacks verify Meta's `signed_request` with `META_APP_SECRET` (set it to the **new**
app's secret; several secrets can be comma-separated). The deletion callback returns the
`url` + `confirmation_code` Meta shows to the person; the status page is `/data-deletion?code=…`.
The `data_deletion_requests` table comes from migration `064`.

## 2. WhatsApp product setup

- **Webhook callback URL:** `https://wacrm.dataslid.com.ng/api/whatsapp/webhook`
- **Verify token:** the value of `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- **Subscribe to fields:** `messages`, `message_template_status_update`, `smb_message_echoes`,
  `smb_app_state_sync`, `history`
- **Embedded Signup → Login Configurations:** one for new numbers (`META_WHATSAPP_CONFIG_ID`)
  and one for coexistence (`META_WHATSAPP_COEXISTENCE_CONFIG_ID`). Set the secrets with
  `wrangler secret put …` — never commit them.
- **System user token** (`META_SYSTEM_USER_ACCESS_TOKEN`) with `whatsapp_business_management`
  and `whatsapp_business_messaging`, from a system user in the verified portfolio.

## 3. Permissions to request (Advanced Access)

| Permission | Why OgaDesk needs it (paste into "How will your app use this permission?") |
| --- | --- |
| `whatsapp_business_messaging` | OgaDesk is a shared inbox. After a business connects its WhatsApp number, it sends and receives messages with its own customers (replies, template messages, broadcasts to opted-in contacts, automations) and reads delivery/read receipts. |
| `whatsapp_business_management` | To onboard the business's WhatsApp Business Account: read the account and phone-number details, subscribe our app to its webhooks, and create, list and sync the business's message templates for approval. |
| `business_management` (only if the dashboard asks) | To read the business portfolio connected through Embedded Signup so we can attach the right WhatsApp Business Account. |

## 4. Screencast(s) reviewers expect

Record one continuous video per permission, English UI, showing the real flow end to end:

1. **Sign up / log in** to OgaDesk (show the Privacy and Terms links on the signup form).
2. **Settings → WhatsApp → Connect a number.** Click through Embedded Signup for a **new number** and
   again for **existing number (coexistence)**. Show the Meta popup, granting access, and the
   connected number appearing with its verified name.
3. **Send and receive:** send a message from the OgaDesk inbox and show it arriving on a phone;
   reply from the phone and show it in the inbox. Show a message **sent from the phone** appearing
   in the inbox (coexistence echo) and the imported chat history.
4. **Templates:** create a template in Settings → Templates, submit it, show its status update.
5. **Broadcast** to opted-in contacts, with opt-out handling mentioned in narration.
6. **Data deletion:** open `/data-deletion`, and disconnect a number in Settings → WhatsApp.

Narrate what data is used and why. Don't show real customer data.

## 4a. Reviewer access

Meta's reviewers need to sign in. Create a **demo account** on production (with a connected test
number and sample contacts), then enter its email + password and a short "how to test" note in
the submission's **Testing instructions** box. Don't use a real customer's account.

## 5. Business verification & Tech Provider

- Complete **Business Verification** for the portfolio (done for Kena; the new app uses the same one).
- Complete **Access Verification** if Meta requests it for Tech Providers.
- In the app's **WhatsApp → Embedded Signup** area, enrol as a **Tech Provider** and accept the
  Tech Provider terms. Coexistence is available to Tech Providers once Embedded Signup is live.
- Make sure the public site matches the verified business: same legal name and website on the
  Privacy Policy, Terms and landing page. The legal pages read the company name and contact email
  from `NEXT_PUBLIC_COMPANY_NAME` and `NEXT_PUBLIC_SUPPORT_EMAIL` (defaults in `src/lib/brand.ts`).

## 6. Before you press Submit

- [ ] `/privacy`, `/terms`, `/data-deletion` load while **signed out** and show the right company name and email.
- [ ] `POST /api/meta/data-deletion` with a signed test request returns `{ url, confirmation_code }` (the Meta dashboard has a test button).
- [ ] The webhook handshake succeeds in the dashboard, and all five fields are subscribed.
- [ ] A fresh account can complete Embedded Signup for both a new and an existing number.
- [ ] The demo account works and the testing instructions are filled in.
- [ ] App is in **Live** mode before the final review request.

## Known gaps to be honest about

- There is no self-service "delete my whole account" button yet; whole-workspace deletion is by
  email request (30 days), as the policy states. Contacts, numbers, members and keys can be removed in-app.
- Legal text is a sensible starting draft, not legal advice. Have a lawyer review it, and confirm the
  governing-law clause (Nigeria) and the operating entity before you publish.
