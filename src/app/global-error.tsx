'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

// Last-resort error page: runs when the root layout itself crashes, so it cannot
// use providers or translations. Reports the crash, then lets the user retry.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0 }}>
        <div style={{ textAlign: 'center', maxWidth: 360, padding: 24 }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, opacity: 0.7, marginBottom: 16 }}>The problem has been reported. Please try again.</p>
          <button onClick={() => reset()} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid currentColor', background: 'transparent', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
