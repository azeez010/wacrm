import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Test payment', robots: { index: false, follow: false, nocache: true } }

// Where the payment provider sends the admin after a TEST payment started from the admin console.
// Public, no data, nothing is activated for any business.
export default function TestComplete() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-semibold">Test payment finished</h1>
      <p className="text-muted-foreground text-sm">You can close this tab and go back to the admin console. No business plan was changed by this test.</p>
    </main>
  )
}
