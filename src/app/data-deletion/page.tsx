import type { Metadata } from 'next'
import Link from 'next/link'
import { Bullets, LegalLayout, Section } from '@/components/legal/legal-layout'
import { BRAND_NAME, COMPANY_NAME, SUPPORT_EMAIL } from '@/lib/brand'
import { getDeletionRequest } from '@/lib/meta/deletion-requests'

export const metadata: Metadata = {
  title: 'Data deletion',
  description: `How to delete your data from ${BRAND_NAME}.`,
  robots: { index: true, follow: true },
}

// Status depends on the ?code= query, so never prerender or cache.
export const dynamic = 'force-dynamic'

const STATUS_TEXT: Record<string, string> = {
  received: 'Received. We will delete the associated data within 30 days.',
  in_progress: 'In progress. We are deleting the associated data.',
  completed: 'Completed. The associated data has been deleted.',
  rejected: 'We could not match this request to any data we hold. Contact us if you think this is a mistake.',
}

export default async function DataDeletionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const code = typeof sp.code === 'string' ? sp.code : null
  const request = code ? await getDeletionRequest(code) : null
  const mail = (
    <a href={`mailto:${SUPPORT_EMAIL}?subject=Data%20deletion%20request`} className="text-primary underline">
      {SUPPORT_EMAIL}
    </a>
  )

  return (
    <LegalLayout
      title="Data deletion"
      intro={`How to have your data removed from ${BRAND_NAME}, and how to check on a request you already made.`}
    >
      {code && (
        <Section title="Status of your request">
          <div className="rounded-lg border bg-card p-4 text-foreground">
            <p className="text-sm text-muted-foreground">Confirmation code</p>
            <p className="font-mono text-sm">{code}</p>
            <p className="mt-3 text-sm">
              {request ? STATUS_TEXT[request.status] : 'We could not find a request with that code. Check the code and try again.'}
            </p>
            {request && (
              <p className="mt-2 text-xs text-muted-foreground">
                Requested {new Date(request.created_at).toUTCString()}
                {request.completed_at ? ` · Completed ${new Date(request.completed_at).toUTCString()}` : ''}
              </p>
            )}
          </div>
        </Section>
      )}

      <Section title="If you removed the app from Facebook or Meta">
        <p>
          When you remove {BRAND_NAME} in your Facebook or Meta settings, Meta sends us a deletion request and shows you a confirmation code that you can look up on this page. {COMPANY_NAME}{' '}
          does not keep a Facebook profile for you; the only identifier we receive is the app-scoped ID Meta sends with the request, which we record against the confirmation code.
        </p>
      </Section>

      <Section title="If you are a business using OgaDesk">
        <p>You can remove data yourself, at any time, in the app:</p>
        <Bullets
          items={[
            'Settings → WhatsApp: disconnect a WhatsApp number (this also removes its stored credentials).',
            'Contacts: delete individual contacts or select several and delete them.',
            'Settings → Team members: remove people from the workspace.',
            'Settings → API keys: revoke keys.',
          ]}
        />
        <p>
          To close the whole workspace and delete everything in it, email {mail} from the account owner&apos;s address. We delete the workspace data within 30 days of verifying the
          request.
        </p>
      </Section>

      <Section title="If you are a customer of a business that uses OgaDesk">
        <p>
          The business decides what happens to your messages. Please ask the business to delete your data; we will help them do it. You can also email {mail} with the phone number
          involved and the business name and we will pass your request on or act on it where we are the controller.
        </p>
      </Section>

      <Section title="What happens next">
        <Bullets
          items={[
            'We confirm we received your request, and may ask you to verify that you own the account or number.',
            'We delete the data within 30 days. Backups are overwritten on the provider’s normal cycle.',
            'We may keep limited billing and security records where the law requires, and aggregated data that no longer identifies anyone.',
          ]}
        />
        <p>
          More detail is in our <Link href="/privacy" className="text-primary underline">Privacy Policy</Link>.
        </p>
      </Section>
    </LegalLayout>
  )
}
