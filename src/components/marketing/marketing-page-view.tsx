import Link from 'next/link'
import { Check } from 'lucide-react'
import { BlogShell } from '@/components/blog/blog-shell'
import { Breadcrumbs } from '@/components/blog/parts'
import { buttonVariants } from '@/components/ui/button'
import { BRAND_NAME } from '@/lib/brand'
import { MARKETING_PAGES, type MarketingPage } from '@/lib/marketing/pages'
import { pagePath } from '@/lib/marketing/route'
import { breadcrumbJsonLd, faqJsonLd, graph, jsonLd, SITE_URL } from '@/lib/seo'
import { cn } from '@/lib/utils'

const UI = {
  en: {
    sections: { solutions: 'Solutions', compare: 'Compare', industries: 'Industries' } as Record<MarketingPage['kind'], string>,
    home: 'Home', startFree: 'Start free', seePricing: 'See pricing', freeToStart: 'Free to start. No card needed.',
    comingSoon: 'Coming soon', beFirst: 'Start free and be first to know', comingNote: 'We are finishing this with Meta. Everything else on this page works today.',
    which: 'Which one fits you', sound: 'Sound familiar?', change: 'What changes with OgaDesk', get: (b: string) => `What you get with ${b}`,
    steps: 'Up and running in three steps', questions: 'Questions', ready: 'Ready to put WhatsApp to work?', readySub: 'Connect your number in minutes and invite your team.',
    templates: 'Free message templates', keep: 'Keep reading', related: 'Related pages',
  },
  fr: {
    sections: { solutions: 'Solutions', compare: 'Comparer', industries: 'Secteurs' } as Record<MarketingPage['kind'], string>,
    home: 'Accueil', startFree: 'Commencer gratuitement', seePricing: 'Voir les tarifs', freeToStart: 'Gratuit pour commencer. Sans carte bancaire.',
    comingSoon: 'Bientôt disponible', beFirst: 'Commencez gratuitement et soyez prévenu en premier', comingNote: 'Nous finalisons cette fonctionnalité avec Meta. Tout le reste de cette page fonctionne dès aujourd’hui.',
    which: 'Lequel vous convient', sound: 'Ça vous dit quelque chose ?', change: 'Ce qui change avec OgaDesk', get: (b: string) => `Ce que vous obtenez avec ${b}`,
    steps: 'Opérationnel en trois étapes', questions: 'Questions', ready: 'Prêt à faire travailler WhatsApp pour vous ?', readySub: 'Connectez votre numéro en quelques minutes et invitez votre équipe.',
    templates: 'Modèles de messages gratuits', keep: 'À lire aussi', related: 'Pages associées',
  },
}

/** Long-form landing page: hero, problems, features, steps, optional table, FAQ and a closing call to action. */
export function MarketingPageView({ page }: { page: MarketingPage }) {
  const lang = page.lang ?? 'en'
  const u = UI[lang]
  const prefix = lang === 'en' ? '' : `/${lang}`
  const path = pagePath(page)
  const url = `${SITE_URL}${path}`
  const related = page.related.map((s) => MARKETING_PAGES.find((p) => p.slug === s && (p.lang ?? 'en') === lang)).filter((p): p is MarketingPage => !!p)
  const ld = graph(
    breadcrumbJsonLd([
      { name: u.home, path: prefix || '/' },
      { name: u.sections[page.kind], path },
      { name: page.name, path },
    ]),
    faqJsonLd(page.faq),
    { '@type': 'WebPage', '@id': `${url}#page`, url, name: page.metaTitle, description: page.metaDescription, isPartOf: { '@id': `${SITE_URL}/#website` } },
  )
  const cta = (
    <div className="flex flex-wrap justify-center gap-3">
      <Link href={`${prefix}/signup`} className={cn(buttonVariants({ size: 'lg' }))}>{page.comingSoon ? u.beFirst : u.startFree}</Link>
      <Link href={`${prefix}/#pricing`} className={cn(buttonVariants({ size: 'lg', variant: 'outline' }))}>{u.seePricing}</Link>
    </div>
  )

  return (
    <BlogShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <Breadcrumbs items={[{ name: u.home, href: prefix || '/' }, { name: u.sections[page.kind] }, { name: page.name }]} />

      <header className="mx-auto max-w-3xl py-10 text-center sm:py-14">
        {page.comingSoon && <p className="mb-3"><span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-950">{u.comingSoon}</span></p>}
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">{page.eyebrow}</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">{page.h1}</h1>
        <p className="mt-5 text-lg text-muted-foreground">{page.lead}</p>
        <div className="mt-8">{cta}</div>
        <p className="mt-3 text-sm text-muted-foreground">{page.comingSoon ? u.comingNote : u.freeToStart}</p>
      </header>

      <section aria-labelledby="problems" className="mx-auto max-w-5xl">
        <h2 id="problems" className="text-center text-2xl font-semibold tracking-tight">{page.kind === 'compare' ? u.which : u.sound}</h2>
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
        <h2 id="features" className="text-center text-2xl font-semibold tracking-tight">{page.kind === 'compare' ? u.change : u.get(BRAND_NAME)}</h2>
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
          {page.note && <p className="mt-3 text-center text-xs text-muted-foreground">{page.note}</p>}
        </section>
      )}

      <section aria-labelledby="steps" className="mx-auto mt-16 max-w-4xl">
        <h2 id="steps" className="text-center text-2xl font-semibold tracking-tight">{u.steps}</h2>
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
        <h2 id="faq" className="text-center text-2xl font-semibold tracking-tight">{u.questions}</h2>
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
        <h2 className="text-2xl font-semibold">{u.ready}</h2>
        <p className="mt-2 opacity-90">{u.readySub}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
           <Link href={`${prefix}/signup`} className={cn(buttonVariants({ size: 'lg', variant: 'secondary' }))}>{u.startFree}</Link>
          {lang === 'en' && <Link href="/templates" className={cn(buttonVariants({ size: 'lg', variant: 'outline' }), 'border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10')}>{u.templates}</Link>}
        </div>
      </section>

      {related.length > 0 && (
        <nav aria-label={u.related} className="mx-auto mt-12 max-w-3xl text-center text-sm">
          <p className="text-muted-foreground">{u.keep}</p>
          <ul className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-2">
            {related.map((r) => (
              <li key={r.slug}><Link href={pagePath(r)} className="text-primary underline">{r.name}</Link></li>
            ))}
          </ul>
        </nav>
      )}
    </BlogShell>
  )
}
