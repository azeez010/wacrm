// Content for the public marketing pages (/solutions/*, /compare/*). English only on purpose:
// these are long-form pages written for search, so they are served at one URL each.
// Keep claims to what the product really does.

export interface MarketingPage {
  slug: string
  kind: 'solutions' | 'compare' | 'industries'
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

const COUNTRY_FEATURES = (currency: string) => [
  { title: 'Shared inbox for your team', body: 'Everyone answers customers from one WhatsApp number, with conversations assigned to the right person.' },
  { title: `Prices you can read in ${currency}`, body: `Plans show an approximate price in ${currency} using a daily exchange rate. The amount you pay is shown at checkout.` },
  { title: 'Broadcasts with approved templates', body: 'Reach customers by tag or segment, personalise each message and see who received and read it.' },
  { title: 'Automations and chatbot flows', body: 'Welcome messages, out-of-hours replies, menus and AI answers from your own knowledge library.' },
  { title: 'Use your existing number', body: 'Connect through Meta, or link the number on your WhatsApp Business app and import your chats.' },
  { title: 'OTP and verification API', body: 'Send login and verification codes over WhatsApp from your own app.' },
]
const COUNTRY_STEPS = [
  { title: 'Create your account', body: 'Sign up free, no card needed.' },
  { title: 'Connect WhatsApp', body: 'Sign in with Meta and link your business number.' },
  { title: 'Serve customers as a team', body: 'Invite teammates, import contacts and send your first template.' },
]
const countryPage = (c: { slug: string; country: string; currency: string; lead: string; problems: MarketingPage['problems']; faq: MarketingPage['faq'] }): MarketingPage => ({
  slug: c.slug,
  kind: 'solutions',
  name: `WhatsApp Business API in ${c.country}`,
  metaTitle: `WhatsApp Business API in ${c.country}`,
  metaDescription: `Use the official WhatsApp Business API in ${c.country} with a shared inbox, broadcasts and automations. Prices shown in ${c.currency}. Free to start.`,
  eyebrow: `Built for ${c.country}`,
  h1: `The WhatsApp Business API for businesses in ${c.country}`,
  lead: c.lead,
  problems: c.problems,
  features: COUNTRY_FEATURES(c.currency),
  steps: COUNTRY_STEPS,
  faq: c.faq,
  related: ['whatsapp-crm', 'shared-whatsapp-inbox', 'whatsapp-broadcast'],
})

const industryPage = (i: { slug: string; name: string; short: string; lead: string; problems: MarketingPage['problems']; features: MarketingPage['features']; steps: MarketingPage['steps']; faq: MarketingPage['faq'] }): MarketingPage => ({
  slug: i.slug,
  kind: 'industries',
  name: i.name,
  metaTitle: `WhatsApp CRM for ${i.short}`,
  metaDescription: `WhatsApp CRM for ${i.short}: answer customers, send updates and follow up with a shared inbox and automations. Free to start.`,
  eyebrow: i.name,
  h1: `WhatsApp for ${i.short}: answer faster, sell more`,
  lead: i.lead,
  problems: i.problems,
  features: i.features,
  steps: i.steps,
  faq: i.faq,
  related: ['whatsapp-crm', 'shared-whatsapp-inbox', 'whatsapp-broadcast'],
})

MARKETING_PAGES.push(
  countryPage({
    slug: 'whatsapp-business-api-ghana',
    country: 'Ghana',
    currency: 'cedis (GHS)',
    lead: 'Your customers in Accra, Kumasi and beyond already chat on WhatsApp. OgaDesk gives your team one shared inbox, broadcasts and automations on the official API.',
    problems: [
      { title: 'Orders and questions pile up on one phone', body: 'Price checks, delivery questions and payment confirmations all arrive at once and one person cannot keep up.' },
      { title: 'Staff changes lose customer history', body: 'When the person holding the phone leaves, the conversations and customer details go with them.' },
      { title: 'Hard to message customers properly', body: 'Sending the same update to many people by hand is slow and can look like spam to WhatsApp.' },
    ],
    faq: [
      { question: 'Can I use OgaDesk in Ghana?', answer: 'Yes. OgaDesk works with the official WhatsApp Business Platform, which is available in Ghana. Connect your number through Meta’s sign-in.' },
      { question: 'Can I see prices in cedis?', answer: 'Yes. Plan prices show an approximate amount in Ghana cedis. The exact amount you pay is shown at checkout.' },
      { question: 'Can I keep my current WhatsApp Business number?', answer: 'Yes. You can link the number from your WhatsApp Business app or connect a new one.' },
      { question: 'Who pays Meta’s message fees?', answer: 'Meta’s own conversation fees are separate from OgaDesk and billed by Meta. Your OgaDesk plan covers the software.' },
    ],
  }),
  countryPage({
    slug: 'whatsapp-business-api-kenya',
    country: 'Kenya',
    currency: 'Kenyan shillings (KES)',
    lead: 'From Nairobi shops to Mombasa tour operators, customers prefer WhatsApp. OgaDesk gives your team a shared inbox, broadcasts and automations on the official API.',
    problems: [
      { title: 'Customers expect instant replies', body: 'A message that waits an hour often becomes a lost sale. One phone cannot answer everyone in time.' },
      { title: 'No record of who said what', body: 'Quotes, bookings and promises live in chats. When two people reply, customers get mixed messages.' },
      { title: 'Follow-ups depend on memory', body: 'Leads go cold because nobody remembers to message them again.' },
    ],
    faq: [
      { question: 'Does OgaDesk work in Kenya?', answer: 'Yes. It uses the official WhatsApp Business Platform. Connect your number with Meta’s sign-in and invite your team.' },
      { question: 'Can I see prices in Kenyan shillings?', answer: 'Yes. Plans show an approximate price in KES. The exact amount is shown at checkout.' },
      { question: 'Can several staff reply from one number?', answer: 'Yes. Invite teammates with roles, assign conversations and see who is handling each one.' },
      { question: 'Can customers reach me through a link or QR code?', answer: 'Yes. Create a lead form or support button, share the link or QR code, and every enquiry lands in your contacts.' },
    ],
  }),
  countryPage({
    slug: 'whatsapp-business-api-south-africa',
    country: 'South Africa',
    currency: 'rand (ZAR)',
    lead: 'WhatsApp is where South African customers already talk to businesses. OgaDesk gives your team a shared inbox, broadcasts and automations on the official API.',
    problems: [
      { title: 'Support and sales share one number', body: 'Enquiries, bookings and after-sales questions mix together and are hard to prioritise.' },
      { title: 'Out-of-hours messages go unanswered', body: 'Customers write in the evening and weekends. Without an auto-reply they hear nothing until Monday.' },
      { title: 'Consent and opt-outs need care', body: 'You should only message people who agreed, and honour requests to stop.' },
    ],
    faq: [
      { question: 'Can I use OgaDesk in South Africa?', answer: 'Yes. OgaDesk uses the official WhatsApp Business Platform. Connect your number with Meta’s sign-in.' },
      { question: 'Can I see prices in rand?', answer: 'Yes. Plans show an approximate price in ZAR. The exact amount is shown at checkout.' },
      { question: 'How do opt-outs work?', answer: 'You can add an Unsubscribe automation that asks the customer to confirm and then blocks them, so broadcasts and automations skip them.' },
      { question: 'Can I send automatic replies after hours?', answer: 'Yes. Use an out-of-office automation, a chatbot flow or an AI agent that answers from your own knowledge.' },
    ],
  }),
  industryPage({
    slug: 'online-stores-and-fashion',
    name: 'Online stores and fashion',
    short: 'online stores and fashion sellers',
    lead: 'Most sales in a small shop start with “How much is this?” on WhatsApp. OgaDesk keeps every enquiry, order and delivery update in one shared inbox so nothing slips.',
    problems: [
      { title: 'Enquiries buried under orders', body: 'Price questions, size checks and payment proofs arrive together and get lost.' },
      { title: 'Delivery questions all day', body: '“Where is my order?” takes hours when you check each chat by hand.' },
      { title: 'Repeat customers forgotten', body: 'You cannot easily tell your best buyers about a new drop.' },
    ],
    features: [
      { title: 'Catalogue replies in one tap', body: 'Save quick replies for prices, sizes, bank details and return policy.' },
      { title: 'Order and delivery templates', body: 'Send approved order confirmation and delivery update messages in a click.' },
      { title: 'Tag buyers and segments', body: 'Tag by item, city or spend, then send a new-arrivals broadcast to the right group.' },
      { title: 'Deals in a pipeline', body: 'Track each order from enquiry to paid to delivered.' },
      { title: 'Auto-reply when you are away', body: 'Greet new customers and say when you will reply, even at night.' },
      { title: 'Lead forms and QR codes', body: 'Put a chat link on Instagram, your bio or packaging.' },
    ],
    steps: [
      { title: 'Connect your number', body: 'Use the number customers already know.' },
      { title: 'Import customers and add tags', body: 'Bring your buyer list from a spreadsheet.' },
      { title: 'Reply, confirm and broadcast', body: 'Use templates for orders and drops.' },
    ],
    faq: [
      { question: 'Can I message customers about a new collection?', answer: 'Yes, with an approved marketing template, to people who agreed to hear from you. Tag buyers and send to that group.' },
      { question: 'Can my staff handle orders together?', answer: 'Yes. Assign each conversation to a teammate and see who is waiting for a reply.' },
      { question: 'Do customers need to install anything?', answer: 'No. They message your WhatsApp number as usual.' },
    ],
  }),
  industryPage({
    slug: 'restaurants',
    name: 'Restaurants and food businesses',
    short: 'restaurants and food businesses',
    lead: 'Orders, reservations and delivery questions all come through WhatsApp. OgaDesk helps your team handle them quickly and keeps regulars coming back.',
    problems: [
      { title: 'Peak hours overwhelm the phone', body: 'Orders and questions stack up exactly when the kitchen is busiest.' },
      { title: 'Reservations get missed', body: 'Bookings made in chat are forgotten or double-booked.' },
      { title: 'No way to reach regulars', body: 'You cannot easily tell past customers about today’s special.' },
    ],
    features: [
      { title: 'Menu auto-reply', body: 'A chatbot flow shows your menu and opening hours as tappable options and hands over to a person when needed.' },
      { title: 'Reservation reminders', body: 'Send approved booking confirmation and reminder messages.' },
      { title: 'Shared inbox for staff', body: 'Front of house and delivery riders reply from the same number.' },
      { title: 'Weekend offers by broadcast', body: 'Message customers who opted in with a special or a new dish.' },
      { title: 'Out-of-hours replies', body: 'Tell customers when you open and how to order.' },
      { title: 'Order tags', body: 'Tag dine-in, takeaway and delivery customers.' },
    ],
    steps: [
      { title: 'Connect your number', body: 'Link the number printed on your menu.' },
      { title: 'Set up the menu flow', body: 'Start from a ready flow template and edit it.' },
      { title: 'Share the chat link or QR', body: 'Put it on tables, receipts and social pages.' },
    ],
    faq: [
      { question: 'Can customers order through WhatsApp?', answer: 'They can message your number, choose from a menu flow and chat with your team. Orders are handled by your staff in the shared inbox.' },
      { question: 'Can I send daily specials?', answer: 'Yes, with an approved marketing template to customers who agreed to receive offers.' },
      { question: 'Will it work on my phone?', answer: 'Yes. OgaDesk runs in your browser on mobile and desktop.' },
    ],
  }),
  industryPage({
    slug: 'schools',
    name: 'Schools and training centres',
    short: 'schools and training centres',
    lead: 'Parents and students prefer WhatsApp. OgaDesk gives your admin team one inbox for admissions, fee reminders and notices.',
    problems: [
      { title: 'Admissions enquiries slip away', body: 'Parents ask about fees and places and need quick answers.' },
      { title: 'Notices reach people unevenly', body: 'Announcements sent one by one are slow and some parents miss them.' },
      { title: 'Fee reminders are awkward', body: 'Chasing payments by hand takes staff time.' },
    ],
    features: [
      { title: 'One inbox for the office', body: 'Several staff answer parents from the school number.' },
      { title: 'Fee and notice templates', body: 'Send approved reminder and notice messages to a class or the whole school using tags.' },
      { title: 'Admissions pipeline', body: 'Track each enquiry from first message to enrolled.' },
      { title: 'FAQ answers on autopilot', body: 'An AI agent answers questions about fees, dates and uniforms from your own documents.' },
      { title: 'Enquiry forms', body: 'Collect admissions leads from your website or a QR code.' },
      { title: 'Roles for staff', body: 'Give teachers read-only access and the office full access.' },
    ],
    steps: [
      { title: 'Connect the school number', body: 'Use the number parents already know.' },
      { title: 'Import parent contacts', body: 'Tag by class or level.' },
      { title: 'Send your first notice', body: 'Use an approved utility template.' },
    ],
    faq: [
      { question: 'Can I message all parents at once?', answer: 'Yes, to parents who agreed to receive messages, using an approved template and a tag or segment.' },
      { question: 'Can the AI answer admissions questions?', answer: 'You can add your fee schedule and policies to a knowledge library, and an AI agent answers from it and hands over to staff when unsure.' },
      { question: 'Is it suitable for tutorial centres and training providers?', answer: 'Yes. The same inbox, forms and templates work for any training business.' },
    ],
  }),
  industryPage({
    slug: 'clinics-and-salons',
    name: 'Clinics, salons and wellness',
    short: 'clinics, salons and wellness businesses',
    lead: 'Appointments run on WhatsApp. OgaDesk helps your front desk confirm bookings, send reminders and follow up after visits.',
    problems: [
      { title: 'No-shows cost money', body: 'Clients forget appointments when nobody reminds them.' },
      { title: 'The front desk is stretched', body: 'Booking questions arrive all day while clients are being served.' },
      { title: 'Follow-up never happens', body: 'Clients who should return are never contacted.' },
    ],
    features: [
      { title: 'Appointment reminders', body: 'Send approved reminder messages with confirm or reschedule options.' },
      { title: 'Shared front-desk inbox', body: 'More than one person can answer from the business number.' },
      { title: 'After-visit follow-up', body: 'Check in with clients and invite repeat visits.' },
      { title: 'Forms for new clients', body: 'Collect details and consent before the first visit.' },
      { title: 'Tags by service', body: 'Group clients by treatment or package.' },
      { title: 'Privacy-minded roles', body: 'Control who on your team can see conversations.' },
    ],
    steps: [
      { title: 'Connect your number', body: 'Link the number on your booking cards.' },
      { title: 'Create reminder templates', body: 'Submit them for approval in OgaDesk.' },
      { title: 'Send reminders and follow-ups', body: 'Use tags and segments to reach the right clients.' },
    ],
    faq: [
      { question: 'Can I send appointment reminders automatically?', answer: 'You can send approved reminder templates to a segment, and use automations for follow-ups. Check which steps suit your booking process.' },
      { question: 'Is client information private?', answer: 'Access is controlled by roles, and you decide which teammates can see conversations. Follow the privacy rules that apply to your profession.' },
      { question: 'Can clients book through a link?', answer: 'You can share a chat link or form so clients start a conversation, and your team confirms the time.' },
    ],
  }),
  industryPage({
    slug: 'real-estate',
    name: 'Real estate and property',
    short: 'real estate agents and property managers',
    lead: 'Leads from listings and ads land on WhatsApp. OgaDesk helps your agents respond first and keep every viewing and deal organised.',
    problems: [
      { title: 'Slow replies lose leads', body: 'Buyers message several agents. The first good answer usually wins.' },
      { title: 'Leads scattered across phones', body: 'Each agent keeps conversations on a personal phone, so nobody sees the full pipeline.' },
      { title: 'Viewings are hard to coordinate', body: 'Times and locations are lost in long chats.' },
    ],
    features: [
      { title: 'Lead forms for each listing', body: 'Collect name, budget and preferred area from a link or QR code, tagged by property.' },
      { title: 'Deal pipeline', body: 'Move leads from enquiry to viewing to offer to closed.' },
      { title: 'Viewing reminders', body: 'Send approved booking confirmations with the time.' },
      { title: 'Assign by agent', body: 'Give each lead to the right person, or share them in turn.' },
      { title: 'Broadcast new listings', body: 'Message interested buyers when a matching property arrives.' },
      { title: 'See response times', body: 'Know which leads waited the longest.' },
    ],
    steps: [
      { title: 'Connect the agency number', body: 'Everyone works from one shared inbox.' },
      { title: 'Create a form per listing', body: 'Share the link or QR on adverts.' },
      { title: 'Work the pipeline', body: 'Reply fast, book viewings and track offers.' },
    ],
    faq: [
      { question: 'Can each agent have their own leads?', answer: 'Yes. Assign leads to agents manually or in turn, and see who owns each conversation.' },
      { question: 'Can I send new listings to past enquiries?', answer: 'Yes, with an approved marketing template to contacts who agreed to hear from you, grouped by tags.' },
      { question: 'Can a lead form feed the pipeline?', answer: 'Yes. Qualified form leads can create a deal in the pipeline you choose.' },
    ],
  }),
  industryPage({
    slug: 'logistics-and-delivery',
    name: 'Logistics and delivery',
    short: 'logistics and delivery companies',
    lead: 'Customers want to know where their parcel is. OgaDesk lets your team send updates and answer tracking questions from one shared WhatsApp inbox.',
    problems: [
      { title: '“Where is my parcel?” all day', body: 'Tracking questions fill the inbox and distract dispatchers.' },
      { title: 'Riders and office are not aligned', body: 'Customers get different answers depending on who replies.' },
      { title: 'Failed deliveries are costly', body: 'Wrong addresses and missed handovers are found out too late.' },
    ],
    features: [
      { title: 'Status update templates', body: 'Send approved pickup, in-transit and delivered messages.' },
      { title: 'Verification codes by API', body: 'Send delivery confirmation codes over WhatsApp from your own system.' },
      { title: 'Shared inbox for dispatch', body: 'Several staff answer from one number, with notes and assignment.' },
      { title: 'Automatic replies', body: 'Answer common questions about rates and hours instantly.' },
      { title: 'Customer segments', body: 'Group senders by business, city or volume.' },
      { title: 'API and webhooks', body: 'Connect your own software to send and receive messages.' },
    ],
    steps: [
      { title: 'Connect your number', body: 'Link the number printed on parcels.' },
      { title: 'Set up status templates', body: 'Submit them for approval.' },
      { title: 'Connect your system by API', body: 'Send updates automatically from your own tools.' },
    ],
    faq: [
      { question: 'Can I send updates automatically from my own system?', answer: 'Yes. The API lets your software send messages and codes, and webhooks tell you about replies and delivery status.' },
      { question: 'Can customers track a parcel in WhatsApp?', answer: 'They can message you, and your team or an automation can reply with status. Updates you start must use approved templates.' },
      { question: 'Can I give riders access?', answer: 'You can invite teammates with limited roles so each person sees only what they need.' },
    ],
  }),
)

export const getMarketingPage = (kind: MarketingPage['kind'], slug: string) => MARKETING_PAGES.find((p) => p.kind === kind && p.slug === slug)
