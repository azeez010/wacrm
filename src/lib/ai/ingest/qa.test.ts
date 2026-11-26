import { describe, it, expect } from 'vitest'
import { chunkText } from '../chunk'
import { contentToQa, parseQaPairs, qaChunks, qaToContent } from './qa'

describe('Q&A sources', () => {
  const pairs = [
    { question: 'Do you ship abroad?', answer: 'Yes, to 30 countries.' },
    { question: 'Refunds?', answer: 'Within 30 days.\n\nKeep the receipt.' },
  ]

  it('stores one chunk per pair, even when pairs are short', () => {
    const content = qaToContent(pairs)
    expect(qaChunks(content)).toEqual([
      'Q: Do you ship abroad?\nA: Yes, to 30 countries.',
      'Q: Refunds?\nA: Within 30 days.\nKeep the receipt.',
    ])
    // The plain chunker would have packed both into one chunk.
    expect(chunkText(content)).toHaveLength(1)
  })

  it('round-trips pairs for editing', () => {
    expect(contentToQa(qaToContent(pairs))).toEqual([
      pairs[0],
      { question: 'Refunds?', answer: 'Within 30 days.\nKeep the receipt.' },
    ])
  })

  it('drops incomplete pairs and junk from a request body', () => {
    expect(
      parseQaPairs([{ question: ' Q ', answer: ' A ' }, { question: 'no answer' }, 'x', null]),
    ).toEqual([{ question: 'Q', answer: 'A' }])
    expect(parseQaPairs('nope')).toEqual([])
  })
})
