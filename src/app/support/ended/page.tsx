// Where a support session lands when it ends or its link is not valid. Seen only by OgaDesk staff, so English only.
const TEXT: Record<string, string> = {
  ended: 'The support session has ended and its login was removed. You can close this tab.',
  expired: 'The support session reached its 30-minute limit and was ended. Start a new one from the admin console if you need more time.',
  invalid: 'This support link is not valid. Links work once and only for 2 minutes. Start a new session from the admin console.',
  failed: 'The support session could not be started. Try again from the admin console.',
}

export default async function SupportEnded({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-2 text-center">
        <h1 className="text-xl font-semibold">OgaDesk support session</h1>
        <p className="text-sm text-muted-foreground">{TEXT[reason ?? 'ended'] ?? TEXT.ended}</p>
      </div>
    </main>
  )
}
