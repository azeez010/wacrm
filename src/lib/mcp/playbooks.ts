/**
 * Playbooks: step-by-step recipes an AI assistant follows to take a goal end to end.
 * Served by the MCP `get_playbook` tool, the server `instructions`, and the prompts.
 * Plain data, like reference.ts. Every tool named in `steps` must exist (a test checks).
 * `{{origin}}` is replaced by the public domain when served.
 */

export interface Playbook {
  title: string
  /** When to use it. */
  when: string
  /** Decisions to ask the user BEFORE building (ask them together, in one message). */
  ask: string[]
  steps: string[]
  notes: string[]
}

export const PLAYBOOK_TOPICS = ['project_kickoff', 'lead_gen', 'support', 'marketing_broadcast', 'developer_api', 'templates'] as const
export type PlaybookTopic = (typeof PLAYBOOK_TOPICS)[number]

export const SERVER_INSTRUCTIONS = `OgaDesk is a WhatsApp CRM: contacts, a shared inbox, lead forms and support buttons, pipelines and deals, automations, chatbot flows, templates, broadcasts, custom fields and tables, segments, webhooks and verification codes (OTP).

How to work:
1. Start with whoami (what this key may do) and get_usage (plan limits). Only tools the key's access allows are listed.
2. For a goal, call get_playbook (topics: ${PLAYBOOK_TOPICS.join(', ')}). "project_kickoff" runs a whole project end to end.
3. Read before you write, and build everything as DRAFTS first (forms, automations and flows are created inactive). Show the user a short summary and get a yes before publishing or activating.
4. Anything that messages customers (send_message, send_broadcast, send_verification) or is hard to undo (deleting) needs the user's explicit go-ahead for that exact action.
5. Ask the user about missing decisions once, in a single message, instead of guessing or asking one by one.
6. Give the user real links: form and embed links come back from create_form / get_form already using our public domain.`

export const PLAYBOOKS: Record<PlaybookTopic, Playbook> = {
  project_kickoff: {
    title: 'Run a whole project end to end',
    when: 'The user describes a goal or project ("I want to launch X", "get leads for Y", "set up support") and wants it built, not just advice.',
    ask: [
      'The goal in one sentence and what success looks like (leads, bookings, sales, fewer support tickets).',
      'Who the audience is and where they come from (ad, website, existing contacts, event).',
      'What you are offering, any price, deadline or offer.',
      'Tone of voice and language(s).',
      'Whether they already have a WhatsApp number connected and approved templates (check with list_templates).',
    ],
    steps: [
      'whoami and get_usage: confirm the key can do what is needed and the plan has room (forms, templates, automations).',
      'Choose the pieces from the other playbooks: lead_gen (capture), support (inbound help), templates then marketing_broadcast (outbound), developer_api (an app integration).',
      'Read what already exists first: list_forms, list_tags, list_custom_fields, list_tables, list_pipelines, list_templates, list_segments, list_automations. Reuse before creating.',
      'Build in this order: custom fields/tables, tags, pipeline, form, automation (welcome + follow-up), templates, segment.',
      'Everything stays a draft. Give the user ONE summary: what was built, the share link, and what still needs their yes (publish the form, activate automations, approve templates, send the broadcast).',
      'Only after their yes: update_form status "active", update_automation is_active true, send_broadcast with confirm.',
      'Existing audience as a file or list? import_contacts with dry_run first, then for real, tagging them with the campaign tag.',
      'Offer to check results later: list_form_submissions, list_deals, list_broadcasts, get_broadcast.',
    ],
    notes: ['Never skip the summary-and-confirm step before anything that goes public or messages people.'],
  },

  lead_gen: {
    title: 'Capture leads with a form',
    when: 'The user wants to collect names/phones/emails from a campaign, website or event.',
    ask: [
      'What to ask for (name, phone, email, company, a message, a choice, consent). Phone is always required.',
      'What the lead should see after submitting: a thank-you message, a redirect to a URL (their site or a payment page), or an open-WhatsApp button with a prefilled message.',
      'Who should follow up (a person, round-robin among agents) and how fast.',
      'Whether to score or qualify leads (needs the Advanced forms plan).',
      'Where the form will live: shareable link, embed on a site, or a QR code.',
      'Whether to verify the visitor with a code before saving the lead (settings.rules.verify: whatsapp, email or both). It keeps fake and mistyped numbers out of your contacts. WhatsApp codes need a connected number and an approved verification template; email codes need a required email field; it needs the Advanced forms plan, and each WhatsApp code counts as one message.',
    ],
    steps: [
      'get_forms_reference, then list_forms to avoid duplicates.',
      'If you need extra data, list_custom_fields / list_tables; create_custom_field or create_table only if nothing fits.',
      'create_tag for the campaign (e.g. "spring-promo") so every lead is tagged.',
      'create_pipeline with stages (New, Contacted, Qualified, {name:"Won",outcome:"won"}, {name:"Lost",outcome:"lost"}) if they track deals; note the pipeline and stage ids.',
      'create_form from a template (contact, quote, webinar, event or blank), then update_form to set fields, settings.success (message | redirect | whatsapp), assignment, autoTag and pipeline.',
      'create_automation with trigger form_submitted: send_template or send_message welcome, add a wait, then a follow-up; validate_automation first and fix activation_issues.',
      'Summarise, get a yes, then update_form status "active" and update_automation is_active true.',
      'Hand over the link and embed snippet from get_form, and say how to see leads: list_form_submissions. Over the plan limit? Leads are kept as "held": after an upgrade (or with room left), release_held_leads (confirm first) processes them.',
      'To reuse a form in another account or keep a backup: export_form, then import_form (it lands as a draft and lists what could not be matched).',
    ],
    notes: ['Free-form WhatsApp messages only work within 24 hours of the customer writing; use an approved template for the first outbound message.', 'A hidden field can capture ?utm / ?ref values from the link.'],
  },

  support: {
    title: 'Set up customer support',
    when: 'The user wants a support button on their site, a shared inbox workflow, or auto-replies and routing.',
    ask: [
      'Which website(s) and which corner/colour/icon for the button, and the greeting text.',
      'Support hours and what to say outside them.',
      'Who handles chats (named agents, round-robin) and who should be notified.',
      'Common questions that could be answered automatically (a menu of options).',
    ],
    steps: [
      'list_team_members for agent ids; list_forms to see any existing support button.',
      'create_form with template "support", then update_form: widget (corner, colour, icon, greeting, animation, preMessage bubble, sound, hours), fields (name, optional email, message), settings.assignment, notify.',
      'create_flow for a simple menu (Sales / Billing / Talk to a person) or create_automation with keyword_match for common questions; validate first.',
      'create_tag for categories if useful. To track support tickets, create_pipeline with kind "support" (default stages New → In progress → Waiting on customer → Resolved → Closed; Resolved/Closed are final stages that close the linked chat). The live-chat widget can open a ticket per new chat (settings.chat.ticket).',
      'Day to day, the team can triage with update_conversation (assign to an agent, close or reopen).',
      'Summarise and ask before update_form status "active"; then give the embed snippet from get_form.',
    ],
    notes: ['Support submissions create a conversation and notify the whole team by default.', 'Do not message customers without their go-ahead; replies in the inbox use send_message within 24 hours or an approved template outside it.'],
  },

  marketing_broadcast: {
    title: 'Send a broadcast campaign',
    when: 'The user wants to message a group of contacts (promo, announcement, reminder).',
    ask: [
      'Who to send to: a saved segment, a tag, or a filter. How many people?',
      'The message and any variables (name, offer, link).',
      'When to send (now or later) and what a reply should trigger.',
    ],
    steps: [
      'get_usage: check message limits. list_templates: find an APPROVED template; if none fits, follow the templates playbook and wait for approval.',
      'Audience from a file or list? import_contacts (dry_run first, then for real) with a tag for this campaign. Then list_segments / create_segment (or filter_contacts to preview the audience and count). Show the user the audience size and a sample.',
      'Ask the user to confirm the template text, language, audience and count. Offer a test first: send_message or send_broadcast to 1-3 of their own numbers.',
      'send_broadcast ONLY with confirm=true after their explicit yes (max 1000 recipients per call; split bigger audiences).',
      'get_broadcast (or list_broadcasts for history) to report progress, delivered/failed counts, and next steps (e.g. an automation on replies, or update_conversation to assign replies to the team).',
    ],
    notes: ['Blocked contacts never receive broadcasts.', 'Marketing templates need opt-in; only message people who agreed.'],
  },

  developer_api: {
    title: 'Help a developer use the API',
    when: 'The user is building an app that talks to OgaDesk (OTP login, sending messages, syncing contacts, receiving events).',
    ask: [
      'What the app needs to do (send OTP codes, send order updates, create contacts, receive replies).',
      'Their language/framework, so you can write the code.',
    ],
    steps: [
      'Get a key for the app: if this connection has the keys:manage scope, create_api_key (fewest scopes the app needs, confirm=true after the user approves the name and scopes; the secret is shown once, so have them store it as an environment variable). Otherwise the user creates it in Settings > API & MCP > New key ("Developer" preset or custom scopes).',
      'Base URL: {{origin}}/api/v1. Send the key as the header X-API-Key: YOUR_KEY (or Authorization: Bearer YOUR_KEY). OpenAPI spec: {{origin}}/api/v1/openapi.json; docs: {{origin}}/docs.',
      'OTP: POST /verifications {to, template?} then POST /verifications/{id}/check {code}. Test the flow with send_verification and check_verification only if the user agrees to message their own phone.',
      'Messages: POST /messages (template outside 24 hours). Contacts: POST /contacts, PATCH /contacts/{id}.',
      'Events: create_webhook with the events they need (message.received, message.status_updated, conversation.created, form.submitted). Tell them to store the secret and verify the X-Wacrm-Signature header.',
      'Write a minimal working example (curl and Node fetch) for each call they need, using their real base URL, and note the plan limits from get_usage.',
    ],
    notes: ['Never paste a real key into code you share; use an environment variable. Revoke a key that leaked with revoke_api_key (or in Settings).', 'Rate limits apply per key; handle 429 with Retry-After.'],
  },

  templates: {
    title: 'Write message templates that get approved',
    when: 'The user needs WhatsApp templates for business-initiated messages (outside the 24-hour window).',
    ask: ['What the message is for (order update, reminder, promo, OTP).', 'Language(s).', 'The variables (name, date, amount, link).'],
    steps: [
      'list_templates to see names, statuses and avoid duplicates.',
      'Pick a category: Utility (order/booking/account updates), Marketing (promos, offers), Authentication (OTP codes).',
      'create_template with a clear name (lowercase_with_underscores), a body with numbered variables {{1}} {{2}}, and an example value for each variable.',
      'Tell the user it is submitted to Meta for approval and may take minutes to a day; check again with list_templates (status).',
      'Check one with get_template (status, rejection reason). Remove an unused or rejected one with delete_template (confirm first).',
      'Use it only once APPROVED: in send_template steps, send_message (template) or send_broadcast.',
    ],
    notes: ['Keep variables out of the first and last word; avoid promotional wording in Utility templates; never ask for passwords or card numbers.'],
  },
}

export function renderPlaybook(topic: PlaybookTopic, origin: string): Playbook {
  const p = PLAYBOOKS[topic]
  const fill = (s: string) => s.replaceAll('{{origin}}', origin)
  return { ...p, steps: p.steps.map(fill), notes: p.notes.map(fill), ask: p.ask.map(fill) }
}

/** Prompts (one-click starts in clients that show them). */
export const PROMPTS: { name: string; title: string; description: string; topic: PlaybookTopic; arg: string }[] = [
  { name: 'marketing_project', title: 'Run a marketing project', description: 'Describe a project; get it built end to end as drafts, then confirm before launch.', topic: 'project_kickoff', arg: 'What is the project?' },
  { name: 'launch_lead_gen', title: 'Launch lead capture', description: 'Create a form, tags, pipeline and follow-up automation.', topic: 'lead_gen', arg: 'What are you promoting?' },
  { name: 'set_up_support', title: 'Set up support', description: 'Support button, routing and auto-replies.', topic: 'support', arg: 'Which website is it for?' },
  { name: 'run_broadcast', title: 'Run a broadcast', description: 'Pick an audience and template, test, then send with confirmation.', topic: 'marketing_broadcast', arg: 'What is the message about?' },
  { name: 'developer_onboarding', title: 'Developer onboarding', description: 'Connect an app: API key, OTP, messages, webhooks.', topic: 'developer_api', arg: 'What is the app?' },
]
