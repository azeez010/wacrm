import type { Metadata } from 'next'
import Link from 'next/link'
import { Bullets, LegalLayout, Section } from '@/components/legal/legal-layout'
import { BRAND_NAME, COMPANY_ADDRESS, COMPANY_LEGAL_LINE, COMPANY_NAME, SUPPORT_EMAIL } from '@/lib/brand'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `How ${BRAND_NAME} collects, uses and protects personal data.`,
  robots: { index: true, follow: true },
}

export default function PrivacyPage() {
  const mail = (
    <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary underline">
      {SUPPORT_EMAIL}
    </a>
  )
  return (
    <LegalLayout
      title="Privacy Policy"
      intro={`${BRAND_NAME} is a WhatsApp CRM operated by ${COMPANY_NAME} ("we", "us"). It lets businesses manage sales, support and marketing conversations on the WhatsApp Business Platform. This policy explains what personal data we handle, why, who we share it with, and the choices you have.`}
    >
      <Section title="1. Who is responsible for which data">
        <Bullets
          items={[
            <>
              <strong className="text-foreground">Our customers (businesses)</strong> decide what data goes into their {BRAND_NAME} workspace and why. For the contacts,
              conversations and messages of their own customers, the business is the controller and we are its processor, acting only on the
              business&apos;s instructions.
            </>,
            <>
              <strong className="text-foreground">We are the controller</strong> of account data (the people who sign in), billing records, security logs and
              product-usage data.
            </>,
          ]}
        />
        <p>If you are a customer of a business that uses {BRAND_NAME} and want to see or delete your messages, please contact that business first. We will help them honour your request.</p>
      </Section>

      <Section title="2. Data we process">
        <Bullets
          items={[
            <><strong className="text-foreground">Account data:</strong> name, email address, role, profile picture, and a securely hashed password handled by our authentication provider.</>,
            <><strong className="text-foreground">Workspace data your business adds:</strong> contacts (name, phone number, email, company, tags, notes, custom fields), pipelines and deals, templates, broadcasts, automations, chatbot flows, quick replies and AI knowledge-base documents.</>,
            <><strong className="text-foreground">WhatsApp conversation data:</strong> messages sent and received through connected WhatsApp numbers (text, media, location, reactions, delivery and read status), including message history imported when a business links an existing WhatsApp Business app number.</>,
            <><strong className="text-foreground">Connection data:</strong> WhatsApp Business Account ID, phone number ID, display number and verified business name. For businesses that bring their own Meta app, the access token is stored encrypted (AES-256-GCM) and never shown again after saving.</>,
            <><strong className="text-foreground">Billing data:</strong> plan, status and payment records. Card details are handled by our payment processor and are never stored by us.</>,
            <><strong className="text-foreground">Onboarding and usage data:</strong> what you tell us when you start (how you plan to use {BRAND_NAME} and how you heard about us), your language and country, your plan and subscription status, and simple usage figures (such as whether a WhatsApp number is connected and how many messages you sent this month). We use it to set up your workspace, to support you and to improve the service.</>,
            <><strong className="text-foreground">Technical data:</strong> IP address, browser and device type, timestamps and error logs, used for security and reliability.</>,
          ]}
        />
      </Section>

      <Section title="3. Data we receive from Meta">
        <p>
          When a business connects WhatsApp through Meta&apos;s Embedded Signup (including &quot;coexistence&quot; for a number that is also used in the WhatsApp Business
          app), we receive from Meta: the business&apos;s WhatsApp Business Account and phone number identifiers, the display name and quality rating, and — through
          webhooks — the messages, delivery statuses, message echoes and chat history for the numbers that business connected. We use this data only to provide the
          messaging features to the business that connected the number.
        </p>
        <p>
          We do not sell Meta platform data, use it for advertising or profiling, or share it with data brokers. We request only the permissions needed to send and receive
          messages and to manage message templates for the connected WhatsApp Business Account.
        </p>
      </Section>

      <Section title="4. How we use data">
        <Bullets
          items={[
            'To provide the service: show the shared inbox, send and receive WhatsApp messages, run broadcasts, automations and flows, and import history.',
            'To secure and operate it: authenticate users, enforce roles and plan limits, prevent abuse and fix problems.',
            'To bill: manage subscriptions and keep payment records.',
            'To support you and to send service notices, such as a welcome email and usage alerts. We send product tips, news and offers only if you opt in, and you can unsubscribe at any time.',
            'To meet legal obligations and enforce our Terms.',
          ]}
        />
        <p>
          AI features are optional. If a business enables them, message text and knowledge-base content are sent to the AI provider the business chose, using the
          business&apos;s own API key. We do not use customer messages to train our own models.
        </p>
      </Section>

      <Section title="5. Who we share data with">
        <p>We use a small number of service providers (sub-processors), only to run the service:</p>
        <Bullets
          items={[
            'Meta Platforms (WhatsApp Business Platform): message delivery and onboarding.',
            'Cloudflare: application hosting, content delivery and file storage.',
            'Supabase: database, authentication and file storage (hosted in the EU, Ireland).',
            'The AI provider a business selects (for example OpenAI or Anthropic), only if AI features are turned on.',
            'Brevo: customer relationship management and email delivery. We share your name, email address, language, country, plan, usage figures and onboarding answers with it, so we can send service emails and, if you opt in, marketing emails.',
            'Payment processors, to take subscription payments.',
          ]}
        />
        <p>We may also disclose data if the law requires it, to protect rights and safety, or in a business transfer (with notice). We never sell personal data.</p>
      </Section>

      <Section title="6. Security">
        <p>
          Data is encrypted in transit (TLS). Stored access tokens and AI keys are encrypted at rest, and API keys are stored only as one-way hashes. Each workspace is isolated at the
          database level with row-level security and role-based access (owner, admin, agent, viewer). No system is perfectly secure; if a breach affects your data we will notify the
          affected business and the authorities as the law requires.
        </p>
      </Section>

      <Section title="7. Retention and deletion">
        <p>
          We keep workspace data while the account is active. A business can delete contacts, conversations and connections at any time in the app. When an account is closed or
          deletion is requested, we delete the workspace data within 30 days, and remaining backups age out on the provider&apos;s backup cycle. We may keep limited billing and
          security records where the law requires.
        </p>
        <p>
          To request deletion, see our <Link href="/data-deletion" className="text-primary underline">data deletion page</Link> or email {mail}.
        </p>
      </Section>

      <Section title="8. Your rights">
        <p>
          Depending on where you live (for example under the GDPR, Nigeria&apos;s NDPA, Brazil&apos;s LGPD or California&apos;s CCPA) you may have the right to access, correct,
          delete, restrict or port your personal data, to object to processing, and to withdraw consent. Email {mail} and we will respond within 30 days. You may also complain to
          your local data-protection authority.
        </p>
      </Section>

      <Section title="9. International transfers">
        <p>
          Data may be processed in countries other than your own, including by our providers. Where required, we rely on appropriate safeguards such as Standard Contractual Clauses.
        </p>
      </Section>

      <Section title="10. Cookies and local storage">
        <p>
          We use only what the app needs: an authentication session cookie, a language preference cookie, and local storage for display preferences (theme, mode). We do not use
          advertising or third-party tracking cookies.
        </p>
      </Section>

      <Section title="11. Children">
        <p>The service is for businesses and is not directed to anyone under 18. We do not knowingly collect children&apos;s data.</p>
      </Section>

      <Section title="12. Changes">
        <p>We will post updates here and change the date above. For material changes we will also notify account owners.</p>
      </Section>

      <Section title="13. Contact">
        <p>
          {COMPANY_LEGAL_LINE}. Registered office: {COMPANY_ADDRESS}. Email: {mail}. See also our <Link href="/terms" className="text-primary underline">Terms of Service</Link> and{' '}
          <Link href="/data-deletion" className="text-primary underline">data deletion instructions</Link>.
        </p>
      </Section>
    </LegalLayout>
  )
}
