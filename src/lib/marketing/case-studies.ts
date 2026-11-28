// Long-form developer case studies (public, English, one URL each). Keep claims to what the product really does and
// keep secrets out. The same text is kept in docs/ as Markdown (caseStudyToMarkdown; a test fails when they drift).

export type CaseBlock =
  | { type: 'p'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; lang: string; caption?: string; code: string }
  | { type: 'callout'; title: string; text: string }
  | { type: 'table'; columns: string[]; rows: string[][] }

export interface CaseSection {
  id: string
  heading: string
  blocks: CaseBlock[]
}

export interface CaseStudy {
  slug: string
  name: string
  metaTitle: string
  metaDescription: string
  eyebrow: string
  h1: string
  lead: string
  /** Small facts strip under the title. */
  facts: { label: string; value: string }[]
  sections: CaseSection[]
  faq: { question: string; answer: string }[]
  /** Slugs of marketing pages (solutions) to link at the end. */
  related: string[]
}

export const CASE_STUDIES: CaseStudy[] = [
  {
    slug: 'ogadesk-crm',
    name: 'How OgaDesk runs its CRM on OgaDesk',
    metaTitle: 'Case study: how OgaDesk runs its own CRM on OgaDesk',
    metaDescription: 'How we sync every OgaDesk signup into our own workspace through the public API: the data model, the mistakes we hit and the exact calls to copy.',
    eyebrow: 'Case study',
    h1: 'How OgaDesk runs its own CRM on OgaDesk',
    lead: 'We needed to see every signup, what they chose and whether they use the product. Instead of buying a CRM, we used our own: each signup becomes a contact in a private OgaDesk workspace, filled in through the public API. This is exactly how it works, what went wrong on the way, and the calls to copy for your own app.',
    facts: [
      { label: 'Setup', value: 'One API key, one settings page' },
      { label: 'Data', value: '33 custom fields, tags for segments' },
      { label: 'Sync', value: 'Background queue with retries' },
      { label: 'Result', value: 'Every signup visible and up to date' },
    ],
    sections: [
      {
        id: 'problem',
        heading: 'The problem',
        blocks: [
          { type: 'p', text: 'Signups lived in our database. Nobody on the team could answer simple questions: who joined this week, which use case did they pick, did they connect WhatsApp, are they about to hit their limit? We wanted a contact list we could filter, tag, message on WhatsApp and hand to a teammate, without exporting spreadsheets.' },
          { type: 'p', text: 'We already had a CRM with all of that: OgaDesk. So the rule became: our own customers are contacts in our own workspace.' },
        ],
      },
      {
        id: 'design',
        heading: 'The design',
        blocks: [
          { type: 'list', items: [
            'A normal OgaDesk workspace is the CRM. Nothing special is built into it.',
            'Our app talks to it only through the public API (/api/v1), with a key created in that workspace. The same API you can use.',
            'One signup is one contact, found or created by email. Their plan, usage and dates are custom fields. Their segments (use case, marketing consent) are tags. Milestones are tags too.',
            'Updates are queued and sent in the background, so a slow request never delays a signup.',
            'The key is saved in our admin console, encrypted, and can be changed or switched off there without a deploy.',
          ] },
        ],
      },
      {
        id: 'setup',
        heading: 'Setup in five minutes',
        blocks: [
          { type: 'p', text: 'In the workspace that will hold your customers, open Settings, API keys and create a key with four permissions: contacts:read, contacts:write, fields:read and fields:write. Check it works:' },
          { type: 'code', lang: 'bash', caption: 'Who does this key belong to, and what can it do?', code: 'curl https://ogadesk.com/api/v1/me \\\n  -H "Authorization: Bearer $OGADESK_CRM_KEY"' },
          { type: 'p', text: 'The answer names the workspace and lists the key\'s scopes. In our admin, Platform settings, Email & CRM, we paste the key and press Test connection. It makes this same call and warns if a scope is missing.' },
          { type: 'callout', title: 'Check your plan first', text: 'The sync creates 33 custom fields. Your plan\'s custom field limit has to be at least that, or the first sync will stop at the limit. We hit this: our workspace was on a plan that allowed 25.' },
        ],
      },
      {
        id: 'model',
        heading: 'The data model',
        blocks: [
          { type: 'p', text: 'Everything we know about a person is written to one contact. The custom fields are created once, on the first sync, with an oga_ prefix so they never clash with fields your team adds.' },
          { type: 'table', columns: ['What', 'Where it lands', 'Examples'], rows: [
            ['Identity', 'Contact name, email, phone', 'name, email, +2348127423455'],
            ['Account and plan', 'Custom fields', 'oga_plan, oga_plan_status, oga_plan_renews_at, oga_lifetime_paid'],
            ['Product usage', 'Custom fields', 'oga_whatsapp_connected, oga_members, oga_messages_this_month, oga_quota_percent'],
            ['Onboarding', 'Custom fields', 'oga_use_cases, oga_heard_from, oga_onboarded_at, oga_signed_up_at'],
            ['Segments', 'Tags', 'All users, Use case: Support, Marketing opt-in'],
            ['Milestones', 'A tag and two fields', 'event: onboarding_completed, oga_last_event, oga_last_event_at'],
          ] },
          { type: 'p', text: 'Creating a field is one call. The key is lower case with underscores, and the type is text, number, bool or date:' },
          { type: 'code', lang: 'bash', caption: 'Create a custom field (the sync does this once per field)', code: 'curl -X POST https://ogadesk.com/api/v1/custom-fields \\\n  -H "Authorization: Bearer $OGADESK_CRM_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"key":"oga_plan","name":"OgaDesk: Plan","type":"text"}\'' },
        ],
      },
      {
        id: 'sync',
        heading: 'The sync, step by step',
        blocks: [
          { type: 'p', text: 'When something about a person changes (they sign up, finish onboarding, change plan, edit their profile), our app adds a small job to a queue and returns immediately. A worker sends queued jobs a few seconds later, and again every five minutes, retrying failures after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours. The job only says "sync this person". It reads the latest data when it runs, so ten quick changes become one accurate update.' },
          { type: 'p', text: 'Each sync is two calls. First, find or create the contact by email:' },
          { type: 'code', lang: 'bash', caption: 'Step 1: find or create by email (an existing match returns 200, a new contact 201)', code: 'curl -X POST https://ogadesk.com/api/v1/contacts \\\n  -H "Authorization: Bearer $OGADESK_CRM_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"email":"ada@example.com","name":"Ada Obi"}\'' },
          { type: 'p', text: 'Then set everything else in one update. Tags are sent as the full list, so we first read the contact\'s current tags and keep every tag our app does not manage:' },
          { type: 'code', lang: 'bash', caption: 'Step 2: name, phone, tags and fields in one PATCH', code: 'curl -X PATCH https://ogadesk.com/api/v1/contacts/$CONTACT_ID \\\n  -H "Authorization: Bearer $OGADESK_CRM_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{\n    "name": "Ada Obi",\n    "phone": "+2348127423455",\n    "tags": ["VIP", "All users", "Use case: Support"],\n    "custom_fields": {\n      "oga_plan": "pro",\n      "oga_signed_up_at": "2026-11-20",\n      "oga_whatsapp_connected": true,\n      "oga_messages_this_month": 12\n    }\n  }\'' },
          { type: 'p', text: 'The same two steps in TypeScript, trimmed to the idea:' },
          { type: 'code', lang: 'ts', caption: 'The core of our sync', code: 'async function syncPerson(p: Person) {\n  const api = (path: string, init?: RequestInit) =>\n    fetch(`https://ogadesk.com/api/v1${path}`, {\n      ...init,\n      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },\n    })\n\n  // 1. find or create by email\n  const { data: contact } = await (await api("/contacts", {\n    method: "POST",\n    body: JSON.stringify({ email: p.email, name: p.name }),\n  })).json()\n\n  // 2. keep tags we do not manage, replace the ones we do\n  const keep = contact.tags.map((t: { name: string }) => t.name).filter((n: string) => !MANAGED.has(n))\n  const body = { tags: [...keep, ...p.segments], custom_fields: toFields(p) }\n\n  const res = await api(`/contacts/${contact.id}`, { method: "PATCH", body: JSON.stringify({ ...body, phone: p.phone }) })\n  if (res.status === 409) {\n    // that number already belongs to another contact: sync everything else\n    await api(`/contacts/${contact.id}`, { method: "PATCH", body: JSON.stringify(body) })\n  }\n}' },
        ],
      },
      {
        id: 'gotchas',
        heading: 'What went wrong, and what we changed',
        blocks: [
          { type: 'list', items: [
            'A phone number was required. Most signups only have an email. The contacts API now accepts an email on its own and leaves the phone empty until you know it.',
            'The WhatsApp number was saved but never synced. We collected it at onboarding, then noticed contacts had no number. The sync simply did not send it, and the API could not set a phone on an existing contact. Both fixed, and people can now change their number in Settings, Profile.',
            'Two people with one number. A phone belongs to one contact per workspace, so the second signup got a 409 phone_in_use. We keep syncing and store the number in an oga_phone field instead of failing the whole update.',
            'The plan\'s field limit. 33 fields do not fit in a 25 field plan. We upgraded the workspace before the first sync.',
            'First sync races. Seven of our first nine contacts needed a second attempt because the fields were still being created. The retry queue absorbed it with no manual work.',
            'Staff are not customers. When our team opens a customer\'s account for support, a temporary login is created. Those logins are skipped by the sync.',
            'Dates must be dates. Date fields take YYYY-MM-DD, so we cut timestamps down before sending.',
            'Never fight your team. We kept hand-added tags (like VIP) by reading the current tags and only replacing the ones the sync manages.',
          ] },
        ],
      },
      {
        id: 'results',
        heading: 'What we have now',
        blocks: [
          { type: 'list', items: [
            'Every signup is a contact in our own workspace within a few minutes, with plan, usage, use cases and consent.',
            'Changing a plan or a phone number in the app updates the contact automatically.',
            'We segment with tags, send approved WhatsApp templates to a segment, and start automations when a tag is added.',
            'Turning the sync off, rotating the key or pointing it at another workspace is a setting in our admin, not a deploy.',
          ] },
          { type: 'p', text: 'At launch we backfilled our nine existing users in one pass, then left it running.' },
        ],
      },
      {
        id: 'copy',
        heading: 'Do it for your own app',
        blocks: [
          { type: 'list', items: [
            'Create a workspace for your customers and an API key with contacts and custom fields read and write.',
            'Decide your fields and prefix them. Create them once at startup (GET /custom-fields, then POST the missing ones).',
            'On every change, queue a job. In the job: POST /contacts with the email, then PATCH the contact with tags and fields.',
            'Treat 429 and 5xx as retryable and 409 phone_in_use as "carry on without the phone".',
            'Act on it: filter by a tag, send a template to the segment, or add an automation that starts when a tag is added.',
          ] },
          { type: 'p', text: 'The full request and response shapes are in the API docs.' },
        ],
      },
    ],
    faq: [
      { question: 'Do I need a developer to do this?', answer: 'Yes. Someone has to call the API from your app or backend. The calls are plain HTTP with a bearer key, and the examples above are complete.' },
      { question: 'Which plan do I need?', answer: 'The public API and custom fields are included from the Starter plan up. Check your plan\'s custom field limit against the number of fields you plan to create.' },
      { question: 'Will this overwrite tags my team adds?', answer: 'Not if you do what we do: read the contact\'s current tags, change only the ones your app manages, and send the full list back.' },
      { question: 'What happens if the OgaDesk API is down?', answer: 'Our sync is queued and retried over about fifteen hours, so nothing is lost and your own app never waits on it.' },
    ],
    related: ['sync-app-signups-to-crm', 'whatsapp-crm', 'whatsapp-broadcast'],
  },
]

export const getCaseStudy = (slug: string) => CASE_STUDIES.find((c) => c.slug === slug)

export const caseStudyPath = (c: Pick<CaseStudy, 'slug'>) => `/case-studies/${c.slug}`

/** The Markdown copy kept in docs/. Generated from the page content so the two never drift. */
export function caseStudyToMarkdown(c: CaseStudy): string {
  const out: string[] = [`# ${c.h1}`, '', `> ${c.eyebrow}. Public page: https://ogadesk.com${caseStudyPath(c)}`, '', c.lead, '']
  out.push(c.facts.map((f) => `- **${f.label}:** ${f.value}`).join('\n'), '')
  for (const s of c.sections) {
    out.push(`## ${s.heading}`, '')
    for (const b of s.blocks) {
      if (b.type === 'p') out.push(b.text, '')
      else if (b.type === 'list') out.push(b.items.map((i) => `- ${i}`).join('\n'), '')
      else if (b.type === 'code') out.push(...(b.caption ? [`*${b.caption}*`, ''] : []), '```' + b.lang, b.code, '```', '')
      else if (b.type === 'callout') out.push(`> **${b.title}.** ${b.text}`, '')
      else if (b.type === 'table') out.push(`| ${b.columns.join(' | ')} |`, `| ${b.columns.map(() => '---').join(' | ')} |`, ...b.rows.map((r) => `| ${r.join(' | ')} |`), '')
    }
  }
  out.push('## Questions', '')
  for (const f of c.faq) out.push(`**${f.question}**`, '', f.answer, '')
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
