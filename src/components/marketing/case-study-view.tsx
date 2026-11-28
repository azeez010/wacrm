import Link from 'next/link'
import { BlogShell } from '@/components/blog/blog-shell'
import { Breadcrumbs } from '@/components/blog/parts'
import { CopyButton } from '@/components/marketing/copy-button'
import { buttonVariants } from '@/components/ui/button'
import { BRAND_NAME } from '@/lib/brand'
import { caseStudyPath, type CaseBlock, type CaseStudy } from '@/lib/marketing/case-studies'
import { MARKETING_PAGES } from '@/lib/marketing/pages'
import { pagePath } from '@/lib/marketing/route'
import { breadcrumbJsonLd, faqJsonLd, graph, jsonLd, SITE_URL } from '@/lib/seo'
import { cn } from '@/lib/utils'

function Block({ b }: { b: CaseBlock }) {
  if (b.type === 'p') return <p className="mt-4 leading-7 text-muted-foreground">{b.text}</p>
  if (b.type === 'list') {
    return (
      <ul className="mt-4 list-disc space-y-2 pl-5 text-muted-foreground marker:text-primary">
        {b.items.map((i) => <li key={i} className="leading-7">{i}</li>)}
      </ul>
    )
  }
  if (b.type === 'callout') {
    return (
      <aside className="mt-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <p className="font-semibold">{b.title}</p>
        <p className="mt-1 text-muted-foreground">{b.text}</p>
      </aside>
    )
  }
  if (b.type === 'table') {
    return (
      <div className="mt-5 overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="bg-muted/50"><tr>{b.columns.map((c) => <th key={c} className="p-3 font-semibold">{c}</th>)}</tr></thead>
          <tbody>
            {b.rows.map((r) => (
              <tr key={r[0]} className="border-t">
                <th scope="row" className="p-3 font-medium">{r[0]}</th>
                {r.slice(1).map((cell, i) => <td key={i} className="p-3 text-muted-foreground">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return (
    <figure className="mt-5">
      {b.caption && <figcaption className="mb-2 text-xs font-medium text-muted-foreground">{b.caption}</figcaption>}
      <div className="relative">
        <div className="absolute right-2 top-2"><CopyButton text={b.code} /></div>
        <pre className="overflow-x-auto rounded-xl border bg-muted/40 p-4 pr-24 text-xs leading-6"><code>{b.code}</code></pre>
      </div>
    </figure>
  )
}

/** Long-form case study: hero, facts, sections with text, code and tables, FAQ and links to related pages. */
export function CaseStudyView({ study }: { study: CaseStudy }) {
  const path = caseStudyPath(study)
  const url = `${SITE_URL}${path}`
  const related = study.related.map((s) => MARKETING_PAGES.find((p) => p.slug === s && (p.lang ?? 'en') === 'en')).filter((p) => !!p)
  const ld = graph(
    breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: 'Case studies', path }, { name: study.name, path }]),
    faqJsonLd(study.faq),
    { '@type': 'Article', '@id': `${url}#article`, url, headline: study.h1, description: study.metaDescription, author: { '@type': 'Organization', name: BRAND_NAME }, publisher: { '@type': 'Organization', name: BRAND_NAME }, isPartOf: { '@id': `${SITE_URL}/#website` } },
  )
  return (
    <BlogShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Case studies' }, { name: study.name }]} />

      <header className="mx-auto max-w-3xl py-10 sm:py-14">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">{study.eyebrow}</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">{study.h1}</h1>
        <p className="mt-5 text-lg leading-8 text-muted-foreground">{study.lead}</p>
        <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {study.facts.map((f) => (
            <div key={f.label} className="rounded-xl border bg-card p-4">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{f.label}</dt>
              <dd className="mt-1 text-sm font-semibold">{f.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <article className="mx-auto max-w-3xl">
        <nav aria-label="On this page" className="rounded-xl bg-muted/40 p-4 text-sm">
          <p className="font-semibold">On this page</p>
          <ol className="mt-2 grid gap-1 sm:grid-cols-2">
            {study.sections.map((s) => <li key={s.id}><a href={`#${s.id}`} className="text-primary hover:underline">{s.heading}</a></li>)}
            <li><a href="#faq" className="text-primary hover:underline">Questions</a></li>
          </ol>
        </nav>
        {study.sections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="mt-12 scroll-mt-24">
            <h2 id={`${s.id}-h`} className="text-2xl font-semibold tracking-tight">{s.heading}</h2>
            {s.blocks.map((b, i) => <Block key={i} b={b} />)}
          </section>
        ))}

        <section id="faq" aria-labelledby="faq-h" className="mt-16 scroll-mt-24">
          <h2 id="faq-h" className="text-2xl font-semibold tracking-tight">Questions</h2>
          <div className="mt-6 divide-y rounded-xl border">
            {study.faq.map((f, i) => (
              <details key={f.question} className="group p-4" open={i === 0}>
                <summary className="cursor-pointer list-none font-medium marker:hidden">{f.question}</summary>
                <p className="mt-2 text-muted-foreground">{f.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </article>

      <section className="mx-auto mt-16 max-w-3xl rounded-2xl bg-primary p-8 text-center text-primary-foreground sm:p-10">
        <h2 className="text-2xl font-semibold">Build the same for your app</h2>
        <p className="mt-2 opacity-90">Create a workspace, add an API key and start syncing. The API docs have every request.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/signup" className={cn(buttonVariants({ size: 'lg', variant: 'secondary' }))}>Start free</Link>
          <Link href="/docs" className={cn(buttonVariants({ size: 'lg', variant: 'outline' }), 'border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10')}>API docs</Link>
        </div>
      </section>

      {related.length > 0 && (
        <section className="mx-auto mt-12 max-w-3xl">
          <h2 className="text-lg font-semibold">Related pages</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {related.map((p) => <li key={p!.slug}><Link href={pagePath(p!)} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>{p!.name}</Link></li>)}
          </ul>
        </section>
      )}
    </BlogShell>
  )
}
