import Link from 'next/link'
import { Check } from 'lucide-react'
import { BlogShell } from '@/components/blog/blog-shell'
import { Breadcrumbs } from '@/components/blog/parts'
import { buttonVariants } from '@/components/ui/button'
import { BRAND_NAME } from '@/lib/brand'
import { getMarketingPage, type MarketingPage } from '@/lib/marketing/pages'
import { breadcrumbJsonLd, faqJsonLd, graph, jsonLd, SITE_URL } from '@/lib/seo'
import { cn } from '@/lib/utils'

const SECTION: Record<MarketingPage['kind'], string> = { solutions: 'Solutions', compare: 'Compare' }

/** Long-form landing page: hero, problems, features, steps, optional table, FAQ and a closing call to action. */
export function MarketingPageView({ page }: { page: MarketingPage }) {
  const url = `${SITE_URL}/${page.kind}/${page.slug}`
  const related = page.related.map((s) => getMarketingPage('solutions', s) ?? getMarketingPage('compare', s)).filter((p): p is MarketingPage => !!p)
  const ld = graph(
    breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: SECTION[page.kind], path: `/${page.kind}/${page.slug}` },
      { name: page.name, path: `/${page.kind}/${page.slug}` },
    ]),
    faqJsonLd(page.faq),
    { '@type': 'WebPage', '@id': `${url}#page`, url, name: page.metaTitle, description: page.metaDescription, isPartOf: { '@id': `${SITE_URL}/#website` } },
  )
  const cta = (
    <div className="flex flex-wrap justify-center gap-3">
      <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }))}>Start free</Link>
      <Link href="/#pricing" className={cn(buttonVariants({ size: 'lg', variant: 'outline' }))}>See pricing</Link>
    </div>
  )

  return (
    <BlogShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: SECTION[page.kind] }, { name: page.name }]} />

      <header className="mx-auto max-w-3xl py-10 text-center sm:py-14">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">{page.eyebrow}</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">{page.h1}</h1>
        <p className="mt-5 text-lg text-muted-foreground">{page.lead}</p>
        <div className="mt-8">{cta}</div>
        <p className="mt-3 text-sm text-muted-foreground">Free to start. No card needed.</p>
      </header>

      <section aria-labelledby="problems" className="mx-auto max-w-5xl">
        <h2 id="problems" className="text-center text-2xl font-semibold tracking-tight">{page.kind === 'compare' ? 'Which one fits you' : 'Sound familiar?'}</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {page.problems.map((p) => (
            <div key={p.title} className="rounded-xl border bg-card p-5">
              <h3 className="font-semibold">{p.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="features" className="mx-auto mt-16 max-w-5xl">
        <h2 id="features" className="text-center text-2xl font-semibold tracking-tight">{page.kind === 'compare' ? 'What changes with OgaDesk' : `What you get with ${BRAND_NAME}`}</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {page.features.map((f) => (
            <div key={f.title} className="rounded-xl border p-5">
              <Check className="mb-2 size-5 text-primary" aria-hidden />
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {page.table && (
        <section aria-labelledby="table" className="mx-auto mt-16 max-w-4xl">
          <h2 id="table" className="text-center text-2xl font-semibold tracking-tight">{page.table.heading}</h2>
          <div className="mt-6 overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="bg-muted/50">
                <tr>{page.table.columns.map((c, i) => <th key={i} className="p-3 font-semibold">{c}</th>)}</tr>
              </thead>
              <tbody>
                {page.table.rows.map((r) => (
                  <tr key={r[0]} className="border-t">
                    <th scope="row" className="p-3 font-medium">{r[0]}</th>
                    <td className="p-3 text-muted-foreground">{r[1]}</td>
                    <td className="p-3">{r[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="steps" className="mx-auto mt-16 max-w-4xl">
        <h2 id="steps" className="text-center text-2xl font-semibold tracking-tight">Up and running in three steps</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-3">
          {page.steps.map((s, i) => (
            <li key={s.title} className="rounded-xl bg-muted/40 p-5">
              <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span>
              <h3 className="mt-3 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="faq" className="mx-auto mt-16 max-w-3xl">
        <h2 id="faq" className="text-center text-2xl font-semibold tracking-tight">Questions</h2>
        <div className="mt-6 divide-y rounded-xl border">
          {page.faq.map((f, i) => (
            <details key={f.question} className="group p-4" open={i === 0}>
              <summary className="cursor-pointer list-none font-medium marker:hidden">{f.question}</summary>
              <p className="mt-2 text-muted-foreground">{f.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-16 max-w-3xl rounded-2xl bg-primary p-8 text-center text-primary-foreground sm:p-10">
        <h2 className="text-2xl font-semibold">Ready to put WhatsApp to work?</h2>
        <p className="mt-2 opacity-90">Connect your number in minutes and invite your team.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/signup" className={cn(buttonVariants({ size: 'lg', variant: 'secondary' }))}>Start free</Link>
          <Link href="/templates" className={cn(buttonVariants({ size: 'lg', variant: 'outline' }), 'border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10')}>Free message templates</Link>
        </div>
      </section>

      {related.length > 0 && (
        <nav aria-label="Related pages" className="mx-auto mt-12 max-w-3xl text-center text-sm">
          <p className="text-muted-foreground">Keep reading</p>
          <ul className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-2">
            {related.map((r) => (
              <li key={r.slug}><Link href={`/${r.kind}/${r.slug}`} className="text-primary underline">{r.name}</Link></li>
            ))}
          </ul>
        </nav>
      )}
    </BlogShell>
  )
}
