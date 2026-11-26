import type { Metadata } from 'next'
import Link from 'next/link'
import { Bullets, LegalLayout, Section } from '@/components/legal/legal-layout'
import { BRAND_NAME, COMPANY_ADDRESS, COMPANY_NAME, SUPPORT_EMAIL } from '@/lib/brand'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: `The terms for using ${BRAND_NAME}.`,
  robots: { index: true, follow: true },
}

export default function TermsPage() {
  return (
    <LegalLayout
      title="Terms of Service"
      intro={`These terms govern your use of ${BRAND_NAME}, operated by ${COMPANY_NAME} ("we", "us"). By creating an account or using the service you agree to them on behalf of yourself and the business you represent.`}
    >
      <Section title="1. The service">
        <p>
          {BRAND_NAME} is a CRM and messaging workspace built on the WhatsApp Business Platform: shared inbox, contacts, pipelines, broadcasts, automations, chatbot flows,
          optional AI assistance, and an API. Features and limits depend on your plan.
        </p>
      </Section>

      <Section title="2. Your account">
        <Bullets
          items={[
            'You must be at least 18 and able to bind your business to these terms.',
            'Keep your credentials and API keys secure; you are responsible for activity under your account.',
            'Account owners control who is invited to the workspace and with what role.',
            'Give accurate information and keep it up to date.',
          ]}
        />
      </Section>

      <Section title="3. WhatsApp and Meta">
        <p>
          Use of WhatsApp through {BRAND_NAME} is also subject to Meta&apos;s terms, including the WhatsApp Business Terms of Service, the WhatsApp Business Messaging Policy and
          the Meta Platform Terms. You are responsible for complying with them. In particular you must:
        </p>
        <Bullets
          items={[
            'Only message people who have given you permission (opt-in) and honour opt-out requests promptly.',
            'Use approved message templates for business-initiated messages outside the 24-hour customer-service window.',
            'Not send spam, deceptive, illegal or prohibited content, or use the service to harass anyone.',
            'Keep your WhatsApp Business Account and phone numbers in good standing.',
          ]}
        />
        <p>Meta may limit, suspend or ban numbers or accounts at its discretion. We are not responsible for Meta&apos;s decisions or for changes to its platform or pricing.</p>
      </Section>

      <Section title="4. Acceptable use">
        <p>You may not misuse the service: no unlawful activity, no attempts to breach or disrupt it, no reverse engineering, no resale without our agreement, and no use that violates others&apos; rights.</p>
      </Section>

      <Section title="5. Your data">
        <p>
          You own the data you put into the service (contacts, messages, content). You give us the right to process it solely to provide the service, as described in our{' '}
          <Link href="/privacy" className="text-primary underline">Privacy Policy</Link>. You are responsible for having a lawful basis to process your customers&apos; data and for
          the content you send.
        </p>
      </Section>

      <Section title="6. Plans, fees and billing">
        <Bullets
          items={[
            'Paid plans are billed in advance for the chosen period; fees are non-refundable except where the law requires.',
            'WhatsApp conversation charges from Meta, and charges from any AI provider you connect, are separate from our fees.',
            'We may change prices or plan limits with reasonable notice. If a payment fails, the account may drop to the Free plan limits until it is resolved.',
          ]}
        />
      </Section>

      <Section title="7. Availability and changes">
        <p>We work to keep the service available but do not guarantee uninterrupted operation. We may improve, change or discontinue features, and will give notice of material changes.</p>
      </Section>

      <Section title="8. Suspension and termination">
        <p>
          You can stop using the service or close your account at any time. We may suspend or terminate access for breach of these terms, legal or platform-policy reasons, or
          non-payment. On termination we handle your data as described in the Privacy Policy, and you can export what you need beforehand.
        </p>
      </Section>

      <Section title="9. Disclaimers and liability">
        <p>
          The service is provided &quot;as is&quot; without warranties of any kind to the extent permitted by law. To the extent permitted by law, we are not liable for indirect or
          consequential losses, lost profits or lost data, and our total liability for any claim is limited to the fees you paid us in the 12 months before the claim.
        </p>
      </Section>

      <Section title="10. Indemnity">
        <p>You will defend and indemnify us against claims arising from your content, your messaging practices or your breach of these terms or Meta&apos;s policies.</p>
      </Section>

      <Section title="11. Changes and governing law">
        <p>
          We may update these terms and will post the new version here; continued use means you accept it. These terms are governed by the laws of the Federal Republic of Nigeria,
          without regard to conflict-of-law rules, and disputes will be handled by the competent courts there.
        </p>
      </Section>

      <Section title="12. Contact">
        <p>
          {COMPANY_NAME}. Registered office: {COMPANY_ADDRESS}. Email:{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </LegalLayout>
  )
}
