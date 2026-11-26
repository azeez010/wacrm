// Content for the public marketing pages (/solutions/*, /compare/*). English only on purpose:
// these are long-form pages written for search, so they are served at one URL each.
// Keep claims to what the product really does.

export interface MarketingPage {
  slug: string
  kind: 'solutions' | 'compare'
  /** Short name used in lists and breadcrumbs. */
  name: string
  metaTitle: string
  metaDescription: string
  eyebrow: string
  h1: string
  lead: string
  /** Why people need this. */
  problems: { title: string; body: string }[]
  /** What you get. */
  features: { title: string; body: string }[]
  steps: { title: string; body: string }[]
  /** Optional comparison table (compare pages). */
  table?: { heading: string; rows: [string, string, string][]; columns: [string, string, string] }
  faq: { question: string; answer: string }[]
  related: string[]
}

export const MARKETING_PAGES: MarketingPage[] = [
  {
    slug: 'whatsapp-crm',
    kind: 'solutions',
    name: 'WhatsApp CRM',
    metaTitle: 'WhatsApp CRM for small businesses',
    metaDescription: 'Keep every customer, chat and deal in one place. OgaDesk is a WhatsApp CRM with contacts, pipelines, tags and automations on the official WhatsApp Business API.',
    eyebrow: 'WhatsApp CRM',
    h1: 'A WhatsApp CRM that remembers every customer for you',
    lead: 'Stop scrolling through chats to find who ordered what. OgaDesk turns your WhatsApp conversations into a customer list, a sales pipeline and follow-ups your whole team can see.',
    problems: [
      { title: 'Customers get lost in chats', body: 'Names, orders and promises are buried in long conversations. Nobody remembers who still needs a reply.' },
      { title: 'Only one phone can see everything', body: 'When the owner owns the number, the team waits. When staff leave, the history leaves with them.' },
      { title: 'No idea what is working', body: 'Without a pipeline you cannot tell which leads are warm, which deals are stuck, or where sales come from.' },
    ],
    features: [
      { title: 'Contacts that fill themselves', body: 'Everyone who messages you becomes a contact with their chat history, tags and custom fields. Import existing customers from a CSV.' },
      { title: 'Pipelines and deals', body: 'Move deals from new lead to won. See the value of what is open, and what has gone quiet for days.' },
      { title: 'Tags, segments and notes', body: 'Group customers by product, city or interest, save the filter as a segment, and leave internal notes your team can see.' },
      { title: 'Follow-ups that run themselves', body: 'Automations tag new contacts, assign conversations and send reminders when a customer has not replied.' },
      { title: 'Lead forms and QR codes', body: 'Collect leads from ads, your website or a shared link. Every lead lands in your contacts with its source.' },
      { title: 'Works with your existing number', body: 'Connect through Meta, or keep using the number on your WhatsApp Business app.' },
    ],
    steps: [
      { title: 'Connect your WhatsApp number', body: 'Sign in with Meta in a few clicks. No developer account needed.' },
      { title: 'Bring your customers in', body: 'Import a CSV, or let contacts build up as people message you.' },
      { title: 'Work from one pipeline', body: 'Reply, tag, assign and move deals. Everything is saved against the customer.' },
    ],
    faq: [
      { question: 'Is OgaDesk a replacement for the WhatsApp Business app?', answer: 'It works with the official WhatsApp Business Platform, which lets a whole team use one number. You can connect a new number or keep the number you already use.' },
      { question: 'Can my team share one WhatsApp number?', answer: 'Yes. Invite teammates with roles (admin, agent, viewer) and they all work from one shared inbox, with conversations assigned to the right person.' },
      { question: 'Can I import my existing customers?', answer: 'Yes. Upload a CSV with names and phone numbers in international format, add tags, and map any extra columns to custom fields.' },
      { question: 'Do I need a card to start?', answer: 'No. You can start free and upgrade when you need more numbers, seats or messages.' },
    ],
    related: ['shared-whatsapp-inbox', 'whatsapp-broadcast', 'whatsapp-business-api-nigeria'],
  },
  {
    slug: 'shared-whatsapp-inbox',
    kind: 'solutions',
    name: 'Shared WhatsApp inbox',
    metaTitle: 'Shared WhatsApp inbox for teams',
    metaDescription: 'Let your whole team answer customers from one WhatsApp number. Assign chats, reply faster and never miss a message with the OgaDesk shared inbox.',
    eyebrow: 'Shared inbox',
    h1: 'One WhatsApp number, your whole team replying',
    lead: 'Sales, support and the owner can all answer customers from the same number, without passing a phone around. See who is handling what and who is still waiting for a reply.',
    problems: [
      { title: 'One phone, one person', body: 'Customers wait while the person holding the phone is busy, asleep or away.' },
      { title: 'Double replies and dropped chats', body: 'Two people answer the same customer, or nobody does. There is no way to see who owns a conversation.' },
      { title: 'Slow replies cost sales', body: 'A customer who does not hear back in minutes often buys from someone else.' },
    ],
    features: [
      { title: 'Assign every conversation', body: 'Give a chat to a teammate, or let it go to the next person in turn. Everyone sees who owns it.' },
      { title: 'See who is waiting', body: 'The dashboard shows customers waiting for a reply, the longest wait, and replies closing out of the free 24-hour window.' },
      { title: 'Quick replies and notes', body: 'Save answers you send often and add internal notes the customer never sees.' },
      { title: 'AI drafts and auto-replies', body: 'Let an AI agent answer common questions from your knowledge library, and hand over to a person when it cannot help.' },
      { title: 'Roles and permissions', body: 'Owners, admins, agents and viewers each get the access they need.' },
      { title: 'Alerts that reach you', body: 'Sound, tab count and browser notifications, even when the tab is closed.' },
    ],
    steps: [
      { title: 'Connect the number', body: 'Link your WhatsApp Business number through Meta.' },
      { title: 'Invite your team', body: 'Send an invite link and choose each role.' },
      { title: 'Answer together', body: 'Assign, reply, close. New messages appear for everyone in real time.' },
    ],
    faq: [
      { question: 'How many teammates can use one number?', answer: 'It depends on your plan. Each plan lists its number of team seats, and you can upgrade when you need more.' },
      { question: 'Can customers tell it is a team?', answer: 'Customers see one business number and name. Your team sees who handled each conversation.' },
      { question: 'Does it work on a phone?', answer: 'Yes. OgaDesk runs in the browser on desktop and mobile, with notifications.' },
      { question: 'What happens after 24 hours?', answer: 'WhatsApp allows free replies within 24 hours of a customer message. After that you use an approved message template, which OgaDesk lets you create and send.' },
    ],
    related: ['whatsapp-crm', 'whatsapp-broadcast', 'whatsapp-business-api-nigeria'],
  },
  {
    slug: 'whatsapp-broadcast',
    kind: 'solutions',
    name: 'WhatsApp broadcast tool',
    metaTitle: 'WhatsApp broadcast tool with approved templates',
    metaDescription: 'Send promotions, updates and reminders to thousands of customers on WhatsApp with approved templates, segments and delivery reports.',
    eyebrow: 'Broadcasts',
    h1: 'Send one WhatsApp message to thousands of customers, the right way',
    lead: 'Announce a sale, remind a customer or share an update using WhatsApp-approved templates. Pick an audience, personalise the message and see who got it, read it and replied.',
    problems: [
      { title: 'Broadcast lists have a tiny limit', body: 'The WhatsApp Business app limits how many people you can reach this way, and only people who saved your number get it.' },
      { title: 'Risk of getting blocked', body: 'Sending the same message by hand to many people looks like spam and can put your number at risk.' },
      { title: 'No results', body: 'You cannot tell who received, read or answered a message.' },
    ],
    features: [
      { title: 'Approved message templates', body: 'Create templates and send them to Meta for approval inside OgaDesk. Use them for broadcasts and for starting conversations.' },
      { title: 'Choose who gets it', body: 'Send to all contacts, a tag, a saved segment or an uploaded CSV, and leave out tags you want to skip.' },
      { title: 'Personalise every message', body: 'Fill template variables with the customer name or any custom field.' },
      { title: 'Schedule and track', body: 'Send now or later, then see delivered, read, replied and failed counts, and export the list.' },
      { title: 'Opt-outs handled', body: 'Customers who ask to stop can be blocked automatically, so they are skipped from then on.' },
      { title: 'Retry what failed', body: 'If a send stops part-way, resume it from the server and retry only the failed recipients.' },
    ],
    steps: [
      { title: 'Create a template', body: 'Write the message and submit it to Meta. Approval usually takes minutes to a day.' },
      { title: 'Pick your audience', body: 'Choose a tag or segment, or upload a CSV.' },
      { title: 'Send and watch results', body: 'Send or schedule, then follow delivery and replies on one page.' },
    ],
    faq: [
      { question: 'Can I message anyone on WhatsApp?', answer: 'Business-started messages must use a template approved by WhatsApp, and you should only message people who agreed to hear from you.' },
      { question: 'How much does it cost to send?', answer: 'Your OgaDesk plan sets how many broadcast recipients you can reach each month. Meta may also charge its own conversation fees, which are separate from OgaDesk.' },
      { question: 'What if someone asks to stop?', answer: 'You can add an Unsubscribe automation that asks them to confirm and then blocks them, so they never get another message.' },
      { question: 'How long do templates take to approve?', answer: 'Usually between a few minutes and a day. The status updates inside OgaDesk.' },
    ],
    related: ['whatsapp-crm', 'shared-whatsapp-inbox', 'whatsapp-business-api-nigeria'],
  },
  {
    slug: 'whatsapp-business-api-nigeria',
    kind: 'solutions',
    name: 'WhatsApp Business API in Nigeria',
    metaTitle: 'WhatsApp Business API in Nigeria',
    metaDescription: 'Use the official WhatsApp Business API in Nigeria with a shared inbox, broadcasts and automations, priced in naira. OgaDesk is built for Nigerian small businesses.',
    eyebrow: 'Built for Nigeria',
    h1: 'The WhatsApp Business API for Nigerian businesses, in naira',
    lead: 'Most of your customers are already on WhatsApp. OgaDesk gives your team a shared inbox, broadcasts and automations on the official API, with prices set in naira.',
    problems: [
      { title: 'Customers chat, but you cannot keep up', body: 'Orders, price questions and delivery updates all arrive on WhatsApp, often at the same time and on one phone.' },
      { title: 'Global tools price in dollars', body: 'Many WhatsApp tools bill in foreign currency, which is hard to budget when the naira moves.' },
      { title: 'Getting approved feels complicated', body: 'Meta business verification and templates can be confusing the first time.' },
    ],
    features: [
      { title: 'Prices set in naira', body: 'Plans are priced in naira, and you can view approximate prices in your own currency. The amount you pay is shown at checkout.' },
      { title: 'Everything for a small team', body: 'Shared inbox, contacts, pipelines, broadcasts, automations, chatbot flows and AI replies in one place.' },
      { title: 'Sign in with Meta in minutes', body: 'Connect a new number or keep the one on your WhatsApp Business app.' },
      { title: 'OTP and verification API', body: 'Send login and verification codes over WhatsApp from your own app.' },
      { title: 'Help in plain English', body: 'Step-by-step guides for setup, templates and your first broadcast.' },
      { title: 'Refer and earn', body: 'Every customer can share a link and earn from the businesses they bring.' },
    ],
    steps: [
      { title: 'Create your account', body: 'Sign up free, no card needed.' },
      { title: 'Connect WhatsApp', body: 'Use a business account on Meta and link your number.' },
      { title: 'Start serving customers', body: 'Invite your team, import contacts and send your first template.' },
    ],
    faq: [
      { question: 'Do I need a registered company?', answer: 'Meta may ask you to verify your business to unlock higher limits. Basic use can start sooner; check Meta’s current requirements for your case.' },
      { question: 'Can I keep my existing WhatsApp Business number?', answer: 'Yes. You can link the number from your WhatsApp Business app, or connect a brand-new number.' },
      { question: 'Is pricing in naira?', answer: 'Yes. Plans are set in naira and shown in your own currency as an estimate. Meta’s own message fees are separate and billed by Meta.' },
      { question: 'Is the API official?', answer: 'Yes. OgaDesk uses the official WhatsApp Business Platform from Meta, so your number stays yours.' },
    ],
    related: ['whatsapp-crm', 'shared-whatsapp-inbox', 'whatsapp-broadcast'],
  },
  {
    slug: 'whatsapp-business-app',
    kind: 'compare',
    name: 'OgaDesk vs the WhatsApp Business app',
    metaTitle: 'OgaDesk vs the WhatsApp Business app',
    metaDescription: 'When the free WhatsApp Business app is enough, and when to move to a shared inbox with broadcasts, automations and team roles on the WhatsApp Business API.',
    eyebrow: 'Compare',
    h1: 'WhatsApp Business app or OgaDesk? How to choose',
    lead: 'The free WhatsApp Business app is a good start. If more than one person answers customers, or you message many people, a shared inbox on the official API saves time and protects your number.',
    problems: [
      { title: 'Choose the app if…', body: 'You are the only person replying, you have a small customer list and you do not need automation or reports.' },
      { title: 'Choose OgaDesk if…', body: 'A team answers customers, you send broadcasts, you want follow-ups to run themselves or you need to see sales and response times.' },
      { title: 'You do not have to choose forever', body: 'OgaDesk can connect the number from your WhatsApp Business app, so you can move when you are ready.' },
    ],
    features: [
      { title: 'Team access', body: 'The app is tied to one phone. OgaDesk lets owners, admins, agents and viewers share one number.' },
      { title: 'Broadcasts at scale', body: 'Send approved templates to tags and segments, with delivery and read reports.' },
      { title: 'Automations and AI', body: 'Welcome messages, out-of-office replies, keyword flows and AI answers from your own knowledge.' },
      { title: 'CRM and reports', body: 'Contacts, pipelines, deals and a dashboard of response times and conversations.' },
    ],
    steps: [
      { title: 'Keep using the app today', body: 'Nothing to change if it already covers you.' },
      { title: 'Try OgaDesk free', body: 'Connect the same number and import your chat history.' },
      { title: 'Move over when ready', body: 'Invite your team and switch your day-to-day work to the shared inbox.' },
    ],
    table: {
      heading: 'Side by side',
      columns: ['', 'WhatsApp Business app', 'OgaDesk'],
      rows: [
        ['People replying', 'One phone, a few linked devices', 'A whole team, with roles'],
        ['Broadcasts', 'Small lists, saved contacts only', 'Segments and tags with approved templates'],
        ['Automation', 'Greeting, away message, quick replies', 'Automations, chatbot flows and AI replies'],
        ['Customer records', 'Labels and notes', 'Contacts, custom fields, pipelines and deals'],
        ['Reports', 'Basic message stats', 'Response times, delivery and campaign results'],
        ['API access', 'No', 'Yes, including WhatsApp OTP codes'],
        ['Cost', 'Free', 'Free to start, paid plans as you grow'],
      ],
    },
    faq: [
      { question: 'Will I lose my chats if I move?', answer: 'OgaDesk can link the number from your WhatsApp Business app and import your chat history.' },
      { question: 'Is OgaDesk allowed by WhatsApp?', answer: 'Yes. It uses the official WhatsApp Business Platform from Meta.' },
      { question: 'Do I need technical skills?', answer: 'No. Connecting takes a few clicks with Meta’s sign-in, and the help center walks you through it.' },
    ],
    related: ['shared-whatsapp-inbox', 'whatsapp-crm', 'whatsapp-broadcast'],
  },
]

export const getMarketingPage = (kind: MarketingPage['kind'], slug: string) => MARKETING_PAGES.find((p) => p.kind === kind && p.slug === slug)
