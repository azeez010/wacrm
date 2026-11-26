// Turns content/help/<lang>/<category>/*.md into src/lib/help/content.generated.json.
// The Worker has no filesystem at runtime, so the help centre is bundled at build time.
// Markdown subset (authored in this repo): ## / ### headings, paragraphs, - and 1. lists,
// > quotes, **bold**, *italic*, `code`, [links](url). Everything else is escaped.
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'content', 'help')
const out = join(root, 'src', 'lib', 'help', 'content.generated.json')

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function inline(text) {
  let s = esc(text)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => (/^(https?:\/\/|\/|#|mailto:)/.test(u) ? `<a href="${u}">${t}</a>` : t))
  return s
}

function render(md) {
  const html = []
  const toc = []
  const lines = md.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    const h = /^(#{2,3})\s+(.*)$/.exec(line)
    if (h) {
      const text = h[2].trim()
      const id = slug(text)
      toc.push({ id, text, level: h[1].length })
      html.push(`<h${h[1].length} id="${id}">${inline(text)}</h${h[1].length}>`)
      i++; continue
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items = []
      while (i < lines.length && (ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/).test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, ''))}</li>`); i++
      }
      html.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`)
      continue
    }
    if (line.startsWith('>')) {
      const q = []
      while (i < lines.length && lines[i].startsWith('>')) { q.push(lines[i].replace(/^>\s?/, '')); i++ }
      html.push(`<blockquote>${inline(q.join(' '))}</blockquote>`)
      continue
    }
    const p = []
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|\s*[-*]\s|\s*\d+\.\s|>)/.test(lines[i])) { p.push(lines[i].trim()); i++ }
    html.push(`<p>${inline(p.join(' '))}</p>`)
  }
  return { html: html.join('\n'), toc }
}

function frontmatter(raw, file) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw)
  if (!m) throw new Error(`${file}: missing frontmatter`)
  const meta = {}
  for (const l of m[1].split('\n')) {
    const k = /^(\w+):\s*(.*)$/.exec(l)
    if (k) meta[k[1]] = k[2].trim()
  }
  if (!meta.title) throw new Error(`${file}: missing title`)
  return { meta, body: m[2] }
}

const dirs = (p) => readdirSync(p).filter((n) => statSync(join(p, n)).isDirectory()).sort()
const data = {}
for (const lang of dirs(src)) {
  const categories = []
  for (const cat of dirs(join(src, lang))) {
    const dir = join(src, lang, cat)
    const metaFile = join(dir, '_category.json')
    const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {}
    const articles = readdirSync(dir)
      .filter((n) => n.endsWith('.md'))
      .map((n) => {
        const { meta: m, body } = frontmatter(readFileSync(join(dir, n), 'utf8'), `${lang}/${cat}/${n}`)
        const { html, toc } = render(body)
        return { slug: n.replace(/\.md$/, ''), title: m.title, summary: m.summary ?? '', order: Number(m.order ?? 99), html, toc }
      })
      .sort((a, b) => a.order - b.order)
    categories.push({ id: cat, emoji: meta.emoji ?? '📘', title: meta.title ?? cat, description: meta.description ?? '', order: meta.order ?? 99, articles })
  }
  categories.sort((a, b) => a.order - b.order)
  data[lang] = categories
}
writeFileSync(out, JSON.stringify(data) + '\n')
console.log(`help: ${Object.entries(data).map(([l, c]) => `${l} ${c.length} categories / ${c.reduce((n, x) => n + x.articles.length, 0)} articles`).join(', ')}`)
