import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { imageUrl, type BlogCard } from '@/lib/blog/api'
import { cn } from '@/lib/utils'

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export function Breadcrumbs({ items }: { items: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="py-4 text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((c, i) => (
          <li key={c.name + i} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>/</span>}
            {c.href ? <Link href={c.href} className="hover:text-foreground">{c.name}</Link> : <span aria-current="page" className="text-foreground">{c.name}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function PostCard({ post, priority = false }: { post: BlogCard; priority?: boolean }) {
  const img = imageUrl(post.cover_image_url)
  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md">
      <Link href={`/blog/${post.slug}`} className="block" tabIndex={-1} aria-hidden>
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" width={post.cover_image_width ?? 1200} height={post.cover_image_height ?? 630}
            loading={priority ? 'eager' : 'lazy'} decoding="async" {...(priority ? { fetchPriority: 'high' as const } : {})}
            className="aspect-[1200/630] w-full object-cover" />
        ) : (
          <div className="flex aspect-[1200/630] items-end bg-gradient-to-br from-primary/80 to-primary p-5 text-lg font-semibold text-primary-foreground">{post.category ?? 'Blog'}</div>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-5">
        {post.category && post.category_slug && (
          <Link href={`/blog/category/${post.category_slug}`} className="text-xs font-medium uppercase tracking-wide text-primary hover:underline">{post.category}</Link>
        )}
        <h2 className="text-lg font-semibold leading-snug">
          <Link href={`/blog/${post.slug}`} className="hover:underline">{post.title}</Link>
        </h2>
        {post.excerpt && <p className="line-clamp-3 text-sm text-muted-foreground">{post.excerpt}</p>}
        <p className="mt-auto pt-2 text-xs text-muted-foreground">
          <time dateTime={post.published_at}>{fmtDate(post.published_at)}</time> · {post.reading_minutes} min read
        </p>
      </div>
    </article>
  )
}

export function PostGrid({ posts }: { posts: BlogCard[] }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {posts.map((p, i) => <PostCard key={p.slug} post={p} priority={i < 3} />)}
    </div>
  )
}

/** Real crawlable links for every page (tradersense only ever showed page 1). */
export function Pagination({ page, totalPages, base }: { page: number; totalPages: number; base: string }) {
  if (totalPages <= 1) return null
  const href = (n: number) => (n === 1 ? base : `${base}/page/${n}`)
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter((n) => n === 1 || n === totalPages || Math.abs(n - page) <= 2)
  return (
    <nav aria-label="Pagination" className="mt-10 flex flex-wrap items-center justify-center gap-1 text-sm">
      {page > 1 && <Link rel="prev" href={href(page - 1)} className="flex items-center gap-1 rounded-md border px-3 py-1.5 hover:bg-accent"><ChevronLeft className="size-4" />Newer</Link>}
      {pages.map((n, i) => (
        <span key={n} className="flex items-center">
          {i > 0 && n - pages[i - 1]! > 1 && <span className="px-1 text-muted-foreground">…</span>}
          <Link href={href(n)} aria-current={n === page ? 'page' : undefined} className={cn('rounded-md px-3 py-1.5', n === page ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}>{n}</Link>
        </span>
      ))}
      {page < totalPages && <Link rel="next" href={href(page + 1)} className="flex items-center gap-1 rounded-md border px-3 py-1.5 hover:bg-accent">Older<ChevronRight className="size-4" /></Link>}
    </nav>
  )
}

export function ShareLinks({ url, title }: { url: string; title: string }) {
  const u = encodeURIComponent(url)
  const t = encodeURIComponent(title)
  const links = [
    { name: 'WhatsApp', href: `https://wa.me/?text=${t}%20${u}` },
    { name: 'X', href: `https://x.com/intent/post?url=${u}&text=${t}` },
    { name: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { name: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Share:</span>
      {links.map((l) => (
        <a key={l.name} href={l.href} target="_blank" rel="noopener noreferrer nofollow" className="rounded-md border px-3 py-1 hover:bg-accent">{l.name}</a>
      ))}
    </div>
  )
}

export function Faq({ items }: { items: { question: string; answer: string }[] }) {
  if (items.length === 0) return null
  return (
    <section aria-labelledby="faq-heading" className="mt-12">
      <h2 id="faq-heading" className="text-2xl font-semibold tracking-tight">Frequently asked questions</h2>
      <div className="mt-4 divide-y rounded-xl border">
        {items.map((f, i) => (
          <details key={i} className="group p-4" open={i === 0}>
            <summary className="cursor-pointer list-none font-medium marker:hidden">{f.question}</summary>
            <p className="mt-2 whitespace-pre-line text-muted-foreground">{f.answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

/** Article body styling without @tailwindcss/typography (same approach as tradersense-web). */
export const ARTICLE_CLASS = cn(
  'text-[17px] leading-[1.75] text-foreground/90',
  '[&_p]:mt-5 [&_p:first-child]:mt-0 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
  '[&_h2]:mt-12 [&_h2]:scroll-mt-24 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground',
  '[&_h3]:mt-8 [&_h3]:scroll-mt-24 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-foreground',
  '[&_ul]:mt-5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mt-5 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mt-2',
  '[&_blockquote]:mt-6 [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:italic',
  '[&_img]:mt-6 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border',
  '[&_pre]:mt-6 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:text-sm [&_code]:font-mono',
  '[&_table]:mt-6 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:bg-muted [&_th]:p-2 [&_th]:text-left',
  '[&_hr]:my-10 [&_mark]:rounded [&_mark]:px-0.5',
)
