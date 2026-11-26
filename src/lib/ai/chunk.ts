// ============================================================
// Knowledge-base chunking.
//
// Splits a document into retrieval-sized pieces:
//   - paragraph-aware (FAQ/policy docs are paragraph-delimited, so a Q&A
//     stays intact), greedily packed up to `maxChars`;
//   - a paragraph too long for one chunk is split at sentence boundaries,
//     with fixed windows only for a single over-long sentence;
//   - consecutive chunks overlap by the last sentence(s) of the previous
//     one (up to `overlap` chars), so an answer that straddles a boundary
//     is still found whole in at least one chunk.
// Pure + deterministic so it's trivially testable and produces stable
// chunk boundaries across re-ingests.
// ============================================================

const DEFAULT_MAX_CHARS = 1200
const DEFAULT_OVERLAP = 200

// Sentence ends: Latin punctuation, plus CJK full stops.
const SENTENCE_SPLIT = /(?<=[.!?。！？])\s+/

function sentences(text: string): string[] {
  return text.split(SENTENCE_SPLIT).map((s) => s.trim()).filter(Boolean)
}

/** Split one over-long paragraph into pieces of at most `budget` chars. */
function splitLong(para: string, budget: number): string[] {
  const out: string[] = []
  let current = ''
  for (const s of sentences(para)) {
    if (s.length > budget) {
      if (current) out.push(current)
      current = ''
      for (let i = 0; i < s.length; i += budget) out.push(s.slice(i, i + budget))
      continue
    }
    if (current && current.length + 1 + s.length > budget) {
      out.push(current)
      current = s
    } else {
      current = current ? `${current} ${s}` : s
    }
  }
  if (current) out.push(current)
  return out
}

/** The trailing sentence(s) of `text`, at most `max` chars. */
export function overlapTail(text: string, max: number): string {
  if (max <= 0) return ''
  const parts = sentences(text.replace(/\n+/g, ' '))
  let tail = ''
  for (let i = parts.length - 1; i >= 0; i--) {
    const next = tail ? `${parts[i]} ${tail}` : parts[i]
    if (next.length > max) break
    tail = next
  }
  if (tail) return tail
  // One long last sentence: its last `max` chars, from a word start.
  const cut = text.slice(-max)
  const space = cut.indexOf(' ')
  return (space > 0 ? cut.slice(space + 1) : cut).trim()
}

export function chunkText(
  content: string,
  opts: { maxChars?: number; overlap?: number } = {},
): string[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS
  const overlap = Math.max(0, Math.min(opts.overlap ?? DEFAULT_OVERLAP, Math.floor(maxChars / 4)))
  const text = content.replace(/\r\n/g, '\n').trim()
  if (!text) return []

  // Every piece leaves room for the carried-over tail plus a joiner.
  const budget = maxChars - (overlap > 0 ? overlap + 2 : 0)
  const pieces = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => (p.length > budget ? splitLong(p, budget) : [p]))

  const chunks: string[] = []
  let current = ''
  for (const piece of pieces) {
    if (current && current.length + 2 + piece.length > maxChars) {
      chunks.push(current)
      const tail = overlapTail(current, overlap)
      current = tail ? `${tail}\n\n${piece}` : piece
    } else {
      current = current ? `${current}\n\n${piece}` : piece
    }
  }
  if (current) chunks.push(current)
  return chunks
}
