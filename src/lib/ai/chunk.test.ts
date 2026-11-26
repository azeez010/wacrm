import { describe, it, expect } from 'vitest'
import { chunkText, overlapTail } from './chunk'

describe('chunkText', () => {
  it('returns nothing for empty / whitespace input', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n\n  ')).toEqual([])
  })

  it('keeps a short document as a single chunk', () => {
    expect(chunkText('Hello world')).toEqual(['Hello world'])
  })

  it('packs multiple paragraphs up to the char budget', () => {
    const a = 'A'.repeat(400)
    const b = 'B'.repeat(400)
    const c = 'C'.repeat(400)
    const out = chunkText(`${a}\n\n${b}\n\n${c}`, { maxChars: 900, overlap: 0 })
    expect(out).toEqual([`${a}\n\n${b}`, c])
  })

  it('starts each chunk with the last sentence of the previous one', () => {
    const p1 = 'Returns are free. ' + 'Filler sentence here. '.repeat(20) + 'Refunds take 5 days.'
    const p2 = 'Exchanges are possible within 30 days of delivery. ' + 'More detail follows. '.repeat(10)
    const out = chunkText(`${p1}\n\n${p2.trim()}`, { maxChars: 700, overlap: 150 })
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(p1)
    const [tail, rest] = out[1].split('\n\n')
    expect(tail.endsWith('Filler sentence here. Refunds take 5 days.')).toBe(true)
    expect(tail.length).toBeLessThanOrEqual(150)
    expect(p1.endsWith(tail)).toBe(true)
    expect(rest.startsWith('Exchanges')).toBe(true)
    expect(out.every((c) => c.length <= 700)).toBe(true)
  })

  it('splits a long paragraph at sentence boundaries', () => {
    const para = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ')
    const out = chunkText(para, { maxChars: 300, overlap: 0 })
    expect(out.length).toBeGreaterThan(1)
    expect(out.every((c) => c.length <= 300 && c.endsWith('.'))).toBe(true)
  })

  it('hard-splits a single sentence larger than the budget', () => {
    const big = 'x'.repeat(2500)
    const out = chunkText(big, { maxChars: 1000, overlap: 0 })
    expect(out).toHaveLength(3)
    expect(out.join('')).toBe(big)
  })

  it('collapses extra blank lines without emitting an empty chunk', () => {
    expect(chunkText('one\n\n\n\ntwo')).toEqual(['one\n\ntwo'])
  })

  it('is deterministic', () => {
    const doc = 'Alpha beta. Gamma delta.\n\n'.repeat(80)
    expect(chunkText(doc)).toEqual(chunkText(doc))
  })
})

describe('overlapTail', () => {
  it('takes whole trailing sentences within the limit', () => {
    expect(overlapTail('One. Two two. Three three three.', 30)).toBe('Two two. Three three three.')
  })

  it('falls back to the last words of one long sentence', () => {
    expect(overlapTail('word '.repeat(50).trim(), 12)).toBe('word word')
  })
})
