# How OgaDesk runs its own CRM on OgaDesk

> Case study. Public page: https://ogadesk.com/case-studies/ogadesk-crm

We needed to see every signup, what they chose and whether they use the product. Instead of buying a CRM, we used our own: each signup becomes a contact in a private OgaDesk workspace, filled in through the public API. This is exactly how it works, what went wrong on the way, and the calls to copy for your own app.

- **Setup:** One API key, one settings page
- **Data:** 33 custom fields, tags for segments
- **Sync:** Background queue with retries
- **Result:** Every signup visible and up to date

## The problem

Signups lived in our database. Nobody on the team could answer simple questions: who joined this week, which use case did they pick, did they connect WhatsApp, are they about to hit their limit? We wanted a contact list we could filter, tag, message on WhatsApp and hand to a teammate, without exporting spreadsheets.

We already had a CRM with all of that: OgaDesk. So the rule became: our own customers are contacts in our own workspace.

## The design

- A normal OgaDesk workspace is the CRM. Nothing special is built into it.
- Our app talks to it only through the public API (/api/v1), with a key created in that workspace. The same API you can use.
- One signup is one contact, found or created by email. Their plan, usage and dates are custom fields. Their segments (use case, marketing consent) are tags. Milestones are tags too.
- Updates are queued and sent in the background, so a slow request never delays a signup.
- The key is saved in our admin console, encrypted, and can be changed or switched off there without a deploy.

## Setup in five minutes

In the workspace that will hold your customers, open Settings, API keys and create a key with four permissions: contacts:read, contacts:write, fields:read and fields:write. Check it works:

*Who does this key belong to, and what can it do?*

```bash
curl https://ogadesk.com/api/v1/me \
  -H "Authorization: Bearer $OGADESK_CRM_KEY"
```

The answer names the workspace and lists the key's scopes. In our admin, Platform settings, Email & CRM, we paste the key and press Test connection. It makes this same call and warns if a scope is missing.

> **Check your plan first.** The sync creates 33 custom fields. Your plan's custom field limit has to be at least that, or the first sync will stop at the limit. We hit this: our workspace was on a plan that allowed 25.

## The data model

Everything we know about a person is written to one contact. The custom fields are created once, on the first sync, with an oga_ prefix so they never clash with fields your team adds.

| What | Where it lands | Examples |
| --- | --- | --- |
| Identity | Contact name, email, phone | name, email, +2348127423455 |
| Account and plan | Custom fields | oga_plan, oga_plan_status, oga_plan_renews_at, oga_lifetime_paid |
| Product usage | Custom fields | oga_whatsapp_connected, oga_members, oga_messages_this_month, oga_quota_percent |
| Onboarding | Custom fields | oga_use_cases, oga_heard_from, oga_onboarded_at, oga_signed_up_at |
| Segments | Tags | All users, Use case: Support, Marketing opt-in |
| Milestones | A tag and two fields | event: onboarding_completed, oga_last_event, oga_last_event_at |

Creating a field is one call. The key is lower case with underscores, and the type is text, number, bool or date:

*Create a custom field (the sync does this once per field)*

```bash
curl -X POST https://ogadesk.com/api/v1/custom-fields \
  -H "Authorization: Bearer $OGADESK_CRM_KEY" \
  -H "Content-Type: application/json" \
  -d '{"key":"oga_plan","name":"OgaDesk: Plan","type":"text"}'
```

## The sync, step by step

When something about a person changes (they sign up, finish onboarding, change plan, edit their profile), our app adds a small job to a queue and returns immediately. A worker sends queued jobs a few seconds later, and again every five minutes, retrying failures after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours. The job only says "sync this person". It reads the latest data when it runs, so ten quick changes become one accurate update.

Each sync is two calls. First, find or create the contact by email:

*Step 1: find or create by email (an existing match returns 200, a new contact 201)*

```bash
curl -X POST https://ogadesk.com/api/v1/contacts \
  -H "Authorization: Bearer $OGADESK_CRM_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","name":"Ada Obi"}'
```

Then set everything else in one update. Tags are sent as the full list, so we first read the contact's current tags and keep every tag our app does not manage:

*Step 2: name, phone, tags and fields in one PATCH*

```bash
curl -X PATCH https://ogadesk.com/api/v1/contacts/$CONTACT_ID \
  -H "Authorization: Bearer $OGADESK_CRM_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Ada Obi",
    "phone": "+2348127423455",
    "tags": ["VIP", "All users", "Use case: Support"],
    "custom_fields": {
      "oga_plan": "pro",
      "oga_signed_up_at": "2026-11-20",
      "oga_whatsapp_connected": true,
      "oga_messages_this_month": 12
    }
  }'
```

The same two steps in TypeScript, trimmed to the idea:

*The core of our sync*

```ts
async function syncPerson(p: Person) {
  const api = (path: string, init?: RequestInit) =>
    fetch(`https://ogadesk.com/api/v1${path}`, {
      ...init,
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    })

  // 1. find or create by email
  const { data: contact } = await (await api("/contacts", {
    method: "POST",
    body: JSON.stringify({ email: p.email, name: p.name }),
  })).json()

  // 2. keep tags we do not manage, replace the ones we do
  const keep = contact.tags.map((t: { name: string }) => t.name).filter((n: string) => !MANAGED.has(n))
  const body = { tags: [...keep, ...p.segments], custom_fields: toFields(p) }

  const res = await api(`/contacts/${contact.id}`, { method: "PATCH", body: JSON.stringify({ ...body, phone: p.phone }) })
  if (res.status === 409) {
    // that number already belongs to another contact: sync everything else
    await api(`/contacts/${contact.id}`, { method: "PATCH", body: JSON.stringify(body) })
  }
}
```

## What went wrong, and what we changed

- A phone number was required. Most signups only have an email. The contacts API now accepts an email on its own and leaves the phone empty until you know it.
- The WhatsApp number was saved but never synced. We collected it at onboarding, then noticed contacts had no number. The sync simply did not send it, and the API could not set a phone on an existing contact. Both fixed, and people can now change their number in Settings, Profile.
- Two people with one number. A phone belongs to one contact per workspace, so the second signup got a 409 phone_in_use. We keep syncing and store the number in an oga_phone field instead of failing the whole update.
- The plan's field limit. 33 fields do not fit in a 25 field plan. We upgraded the workspace before the first sync.
- First sync races. Seven of our first nine contacts needed a second attempt because the fields were still being created. The retry queue absorbed it with no manual work.
- Staff are not customers. When our team opens a customer's account for support, a temporary login is created. Those logins are skipped by the sync.
- Dates must be dates. Date fields take YYYY-MM-DD, so we cut timestamps down before sending.
- Never fight your team. We kept hand-added tags (like VIP) by reading the current tags and only replacing the ones the sync manages.

## What we have now

- Every signup is a contact in our own workspace within a few minutes, with plan, usage, use cases and consent.
- Changing a plan or a phone number in the app updates the contact automatically.
- We segment with tags, send approved WhatsApp templates to a segment, and start automations when a tag is added.
- Turning the sync off, rotating the key or pointing it at another workspace is a setting in our admin, not a deploy.

At launch we backfilled our nine existing users in one pass, then left it running.

## Do it for your own app

- Create a workspace for your customers and an API key with contacts and custom fields read and write.
- Decide your fields and prefix them. Create them once at startup (GET /custom-fields, then POST the missing ones).
- On every change, queue a job. In the job: POST /contacts with the email, then PATCH the contact with tags and fields.
- Treat 429 and 5xx as retryable and 409 phone_in_use as "carry on without the phone".
- Act on it: filter by a tag, send a template to the segment, or add an automation that starts when a tag is added.

The full request and response shapes are in the API docs.

## Questions

**Do I need a developer to do this?**

Yes. Someone has to call the API from your app or backend. The calls are plain HTTP with a bearer key, and the examples above are complete.

**Which plan do I need?**

The public API and custom fields are included from the Starter plan up. Check your plan's custom field limit against the number of fields you plan to create.

**Will this overwrite tags my team adds?**

Not if you do what we do: read the contact's current tags, change only the ones your app manages, and send the full list back.

**What happens if the OgaDesk API is down?**

Our sync is queued and retried over about fifteen hours, so nothing is lost and your own app never waits on it.
