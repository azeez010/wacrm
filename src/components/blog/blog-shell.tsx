import Link from 'next/link'
import { BrandLogo } from '@/components/brand-logo'
import { buttonVariants } from '@/components/ui/button'
import { BRAND_NAME, COMPANY_LEGAL_LINE } from '@/lib/brand'
import { cn } from '@/lib/utils'

// Public chrome for the blog (layout modelled on tradersense-web BlogLayout, styled like ogadesk.com).
// No auth lookup here, so blog pages stay fast and cacheable.
export function BlogShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link href="/" aria-label={`${BRAND_NAME} home`}>
            <BrandLogo className="text-lg" markClassName="h-8 w-8" />
          </Link>
          <nav className="flex items-center gap-2 text-sm" aria-label="Main">
            <Link href="/blog" className="hidden px-2 py-1 text-muted-foreground hover:text-foreground sm:inline">Blog</Link>
            <Link href="/login" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>Log in</Link>
            <Link href="/signup" className={cn(buttonVariants({ size: 'sm' }))}>Start free</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-20 sm:px-6">{children}</main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>{COMPANY_LEGAL_LINE}</p>
          <nav className="flex flex-wrap gap-4" aria-label="Footer">
            <Link href="/blog" className="hover:text-foreground">Blog</Link>
            <a href="/blog/feed.xml" className="hover:text-foreground">RSS</a>
            <Link href="/partners" className="hover:text-foreground">Partners</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
