import { describe, it, expect } from 'vitest'
import { parseSourceInput, urlLabel } from './source-input'

const ACCT = 'acct-1'
const parse = (body: unknown) => parseSourceInput(body, { accountId: ACCT })

describe('parseSourceInput', () => {
  it('rejects unknown types', () => {
    expect(parse({ type: 'pdf' })).toEqual({ error: 'type_invalid' })
  })

  it('needs a name and content for text', () => {
    expect(parse({ type: 'text', content: 'x' })).toEqual({ error: 'name_required' })
    expect(parse({ type: 'text', name: 'FAQ', content: ' ' })).toEqual({ error: 'content_required' })
    expect(parse({ type: 'text', name: 'FAQ', content: 'Hello' })).toMatchObject({
      data: { type: 'text', name: 'FAQ', document: { title: 'FAQ', content: 'Hello', url: null } },
    })
  })

  it('stores Q&A pairs as one document', () => {
    const out = parse({ type: 'qa', name: 'Shipping', pairs: [{ question: 'Q1', answer: 'A1' }] })
    expect(out).toMatchObject({ data: { document: { content: 'Q: Q1\nA: A1' } } })
    expect(parse({ type: 'qa', name: 'Shipping', pairs: [] })).toEqual({ error: 'pairs_required' })
  })

  it("only accepts files uploaded to the account's own folder", () => {
    const file = { name: 'policy.pdf', mime: 'application/pdf', size: 1000, storage_path: `account-${ACCT}/x.pdf`, text: 'Body' }
    expect(parse({ type: 'file', file })).toMatchObject({
      data: { name: 'policy.pdf', config: { storagePath: `account-${ACCT}/x.pdf` }, document: { content: 'Body' } },
    })
    expect(parse({ type: 'file', file: { ...file, storage_path: 'account-other/x.pdf' } })).toEqual({ error: 'file_invalid' })
    expect(parse({ type: 'file', file: { ...file, storage_path: `account-${ACCT}/../x.pdf` } })).toEqual({ error: 'file_invalid' })
    expect(parse({ type: 'file', file: { ...file, mime: 'application/zip' } })).toEqual({ error: 'file_invalid' })
    expect(parse({ type: 'file', file: { ...file, size: 30 * 1024 * 1024 } })).toEqual({ error: 'file_invalid' })
    expect(parse({ type: 'file', file: { ...file, text: '' } })).toEqual({ error: 'file_empty' })
  })

  it('queues a web page with a readable default name', () => {
    expect(parse({ type: 'url', url: 'https://www.acme.com/help/returns/', sync_interval: 'weekly' })).toMatchObject({
      data: { name: 'acme.com/help/returns', syncInterval: 'weekly', document: { url: 'https://www.acme.com/help/returns/' } },
    })
    expect(parse({ type: 'url', url: 'javascript:alert(1)' })).toEqual({ error: 'url_invalid' })
    expect(parse({ type: 'url', url: 'https://user:pw@acme.com' })).toEqual({ error: 'url_invalid' })
  })

  it('caps website pages and has no first document', () => {
    expect(parse({ type: 'website', start_url: 'https://acme.com', max_pages: 9999, include: 'help' })).toMatchObject({
      data: { name: 'acme.com', config: { maxPages: 200, include: ['/help'], exclude: [] }, document: null },
    })
  })
})

describe('urlLabel', () => {
  it('drops www and the trailing slash', () => {
    expect(urlLabel('https://www.a.com/')).toBe('a.com')
  })
})
