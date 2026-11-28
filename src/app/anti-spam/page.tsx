import type { Metadata } from 'next'
import Link from 'next/link'
import { Bullets, LegalLayout, Section } from '@/components/legal/legal-layout'
import { BRAND_NAME, COMPANY_NAME, SUPPORT_EMAIL } from '@/lib/brand'
import { SITE_URL } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Anti-Spam Policy',
  description: `How ${BRAND_NAME} customers must collect consent, honour opt-outs and send WhatsApp messages, and how to report spam.`,
  robots: { index: true, follow: true },
  alternates: { canonical: `${SITE_URL}/anti-spam` },
}

export default function AntiSpamPage() {
  return (
    <LegalLayout
      title="Anti-Spam Policy"
      intro={`${BRAND_NAME} is for conversations people want. This policy explains what every business using ${BRAND_NAME} must do before and while messaging customers on WhatsApp, website chat or any other channel, and what ${COMPANY_NAME} does when the rules are broken. It is part of our Terms of Service.`}
    >
      <Section title="1. What we mean by spam">
        <p>Spam is any message sent to someone who has not agreed to hear from you, or who has asked you to stop. It also includes messages that are:</p>
        <Bullets
          items={[
            'Sent to contacts bought, rented, scraped or shared from another business.',
            'Sent to numbers generated, guessed or harvested from groups, websites or directories.',
            'Misleading about who is sending them or why, or that hide how to opt out.',
            'Unrelated to what the person agreed to receive, or sent far more often than they would reasonably expect.',
          ]}
        />
      </Section>

      <Section title="2. Get permission first (opt-in)">
        <p>Before you send a business-initiated message, the person must have opted in to receive WhatsApp messages from your business. A valid opt-in:</p>
        <Bullets
          items={[
            'Clearly names your business and says they will receive messages on WhatsApp.',
            'Is given actively by the person, for example by ticking a box, submitting a form or messaging you first. A pre-ticked box is not consent.',
            'Covers the kind of messages you send. Agreeing to order updates is not agreement to marketing.',
            'Can be shown on request. Keep a record of when and how each contact opted in.',
          ]}
        />
        <p>
          A customer who messages you first can be answered inside the 24-hour customer-service window. Messages outside that window must use a template approved by Meta.
        </p>
      </Section>

      <Section title="3. Make it easy to stop (opt-out)">
        <Bullets
          items={[
            'Honour every request to stop, in whatever words it is made, and do it promptly.',
            `Keep the ${BRAND_NAME} unsubscribe automation turned on, or handle opt-outs another way. By default, a contact who sends an unsubscribe keyword is asked to confirm and is then blocked from further messages.`,
            'Do not message a contact again after they opt out unless they opt in again themselves.',
            'Do not re-import or re-add opted-out contacts to get around an opt-out.',
          ]}
        />
      </Section>

      <Section title="4. Send responsibly">
        <Bullets
          items={[
            'Send broadcasts only to contacts who opted in to that kind of message, and use tags and segments to keep audiences relevant.',
            'Identify your business and keep messages honest. No false urgency, fake prizes or misleading links.',
            'Respect reasonable hours and frequency for your customers’ time zone.',
            'Use AI replies, automations and the API with the same care. You are responsible for every message sent from your workspace, whoever or whatever sends it.',
          ]}
        />
      </Section>

      <Section title="5. Content you may not send">
        <p>
          You must follow Meta&apos;s WhatsApp Business Messaging Policy and Commerce Policy. Among other things, you may not use {BRAND_NAME} to send content that is illegal,
          fraudulent, deceptive, harassing or hateful, that promotes prohibited goods or services, or that phishes for passwords, card details or other personal information.
        </p>
      </Section>

      <Section title="6. Meta’s limits and quality rating">
        <p>
          Meta rates every WhatsApp number on how recipients respond. When people block or report your messages, Meta may lower your quality rating, reduce how many people you
          can message, pause templates, or restrict or ban your number. These decisions are made by Meta, not {BRAND_NAME}, and we cannot reverse them. Following this policy is
          the best way to protect your number.
        </p>
      </Section>

      <Section title="7. What we do about spam">
        <p>If we receive a complaint, or see signs of spam or abuse, we may, without notice where needed to protect recipients or the platform:</p>
        <Bullets
          items={[
            'Ask you for proof of opt-in for the contacts involved.',
            'Pause broadcasts, automations, API keys or specific features.',
            'Suspend or close the workspace, as set out in our Terms of Service.',
            'Report the activity to Meta or to the authorities where the law requires it.',
          ]}
        />
      </Section>

      <Section title="8. Report spam">
        <p>
          If you received an unwanted message sent through {BRAND_NAME}, email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}?subject=Spam%20report`} className="text-primary underline">{SUPPORT_EMAIL}</a> with the sending business&apos;s name or number, the
          date, and a screenshot if you have one. You can also reply STOP to the business, and block or report the number in WhatsApp.
        </p>
      </Section>

      <Section title="9. Related policies">
        <p>
          This policy works together with our <Link href="/terms" className="text-primary underline">Terms of Service</Link> and{' '}
          <Link href="/privacy" className="text-primary underline">Privacy Policy</Link>. We may update it; the date at the top shows the latest version.
        </p>
      </Section>
    </LegalLayout>
  )
}
