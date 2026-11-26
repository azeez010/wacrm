// ============================================================
// Q&A sources: each question-and-answer pair is stored as one paragraph
// and retrieved as its own chunk, so an answer never gets split from its
// question or mixed with a neighbour.
// ============================================================

import { KNOWLEDGE_LIMITS } from './limits'

export interface QaPair {
  question: string
  answer: string
}

/** Clean pairs from a request body: both sides present, capped. */
export function parseQaPairs(input: unknown): QaPair[] {
  if (!Array.isArray(input)) return []
  const out: QaPair[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const q = typeof (item as QaPair).question === 'string' ? (item as QaPair).question.trim() : ''
    const a = typeof (item as QaPair).answer === 'string' ? (item as QaPair).answer.trim() : ''
    if (q && a) out.push({ question: q, answer: a })
    if (out.length >= KNOWLEDGE_LIMITS.maxQaPairs) break
  }
  return out
}

/** Stored document text for a set of pairs. */
export function qaToContent(pairs: QaPair[]): string {
  return pairs
    .map((p) => `Q: ${oneParagraph(p.question)}\nA: ${oneParagraph(p.answer)}`)
    .join('\n\n')
}

/** Back from stored text to pairs (for editing). */
export function contentToQa(content: string): QaPair[] {
  return qaChunks(content)
    .map((block) => {
      const m = block.match(/^Q:\s*([\s\S]*?)\nA:\s*([\s\S]*)$/)
      return m ? { question: m[1].trim(), answer: m[2].trim() } : null
    })
    .filter((p): p is QaPair => p !== null)
}

/** One chunk per pair. */
export function qaChunks(content: string): string[] {
  return content
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n(?=Q:)/)
    .map((b) => b.trim())
    .filter(Boolean)
}

// Blank lines inside an answer would split the pair, so fold them.
function oneParagraph(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n\s*\n+/g, '\n').trim()
}
