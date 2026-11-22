import { describe, expect, it } from 'vitest'
import { renderEmail } from './render'

describe('renderEmail', () => {
  it('renders the welcome email for the first picked use case, listing the rest', async () => {
    const r = await renderEmail('welcome', 'en', { name: 'Jane', useCases: ['sales', 'developer'] })
    expect(r.subject).toBe('Welcome to OgaDesk')
    expect(r.html).toContain('Welcome to OgaDesk, Jane')
    expect(r.html).toContain('Open the API docs') // developer outranks sales for the call to action
    expect(r.html).toContain('/docs')
    expect(r.text).toContain('Sales: Add your contacts')
    expect(r.text).toContain('Developer API: Connect a number')
  })

  it('falls back to a support welcome when no use case was picked', async () => {
    const r = await renderEmail('welcome', 'en', { name: '', useCases: [] })
    expect(r.html).toContain('Connect WhatsApp')
    expect(r.html).toContain('Welcome to OgaDesk, there')
  })

  it("speaks the recipient's language and falls back to English for unknown ones", async () => {
    expect((await renderEmail('welcome', 'fr', { name: 'Jane', useCases: ['developer'] })).subject).toBe('Bienvenue sur OgaDesk')
    expect((await renderEmail('welcome', 'ko', { name: 'Jane', useCases: [] })).subject).toContain('OgaDesk')
    expect((await renderEmail('welcome', 'xx', { name: 'Jane', useCases: [] })).subject).toBe('Welcome to OgaDesk')
    expect((await renderEmail('welcome', null, { name: 'Jane', useCases: [] })).subject).toBe('Welcome to OgaDesk')
  })

  it('renders the usage alerts with the real numbers', async () => {
    const r80 = await renderEmail('quota_80', 'en', { name: 'Jane', planName: 'Free', used: 800, limit: 1000 })
    expect(r80.subject).toContain('80%')
    expect(r80.text).toContain('Free plan includes 1,000 messages')
    expect(r80.text).toContain('used 800')
    const r100 = await renderEmail('quota_100', 'es', { name: 'Jane', planName: 'Free', used: 1000, limit: 1000 })
    expect(r100.subject).toContain('límite')
    expect(r100.html).toContain('tab=billing')
  })

  it('escapes anything that could carry markup', async () => {
    const r = await renderEmail('welcome', 'en', { name: '<img src=x onerror=alert(1)>', useCases: [] })
    expect(r.html).not.toContain('<img')
    expect(r.html).toContain('&lt;img')
  })
})
