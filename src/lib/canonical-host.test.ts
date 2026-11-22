import { describe, expect, it } from 'vitest'
import { canonicalRedirect } from './canonical-host'

describe('canonicalRedirect', () => {
  it('sends pages on the legacy and www hosts to ogadesk.com, keeping path and query', () => {
    expect(canonicalRedirect('ogadesk.dataslid.com.ng', 'GET', '/contacts', '?new=1')).toBe('https://ogadesk.com/contacts?new=1')
    expect(canonicalRedirect('www.ogadesk.com', 'GET', '/', '')).toBe('https://ogadesk.com/')
    expect(canonicalRedirect('WACRM.dataslid.com.ng:443', 'HEAD', '/fr', '')).toBe('https://ogadesk.com/fr')
  })
  it('serves the canonical host and unknown hosts as is', () => {
    expect(canonicalRedirect('ogadesk.com', 'GET', '/contacts', '')).toBeNull()
    expect(canonicalRedirect('localhost:3000', 'GET', '/', '')).toBeNull()
    expect(canonicalRedirect(null, 'GET', '/', '')).toBeNull()
  })
  it('never redirects API routes (webhooks, API clients) or non-GET requests', () => {
    expect(canonicalRedirect('ogadesk.dataslid.com.ng', 'POST', '/api/whatsapp/webhook', '')).toBeNull()
    expect(canonicalRedirect('ogadesk.dataslid.com.ng', 'GET', '/api/whatsapp/webhook', '?hub.mode=subscribe')).toBeNull()
    expect(canonicalRedirect('ogadesk.dataslid.com.ng', 'POST', '/contacts', '')).toBeNull()
  })
})
