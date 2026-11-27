import { describe, expect, it } from 'vitest'
import { checkMintScopes } from './mint-guard'

describe('checkMintScopes', () => {
  const caller = ['keys:manage', 'contacts:read', 'forms:read']
  it('allows a subset of the caller scopes', () => {
    expect(checkMintScopes(['contacts:read'], caller)).toEqual({ ok: true, scopes: ['contacts:read'] })
  })
  it('refuses scopes the caller does not have (no escalation)', () => {
    const r = checkMintScopes(['contacts:read', 'messages:send'], caller)
    expect(r).toMatchObject({ ok: false, status: 403 })
    expect(r.ok ? '' : r.error).toContain('messages:send')
  })
  it('never lets a minted key carry workspaces:manage (cross-workspace), even if the caller has it', () => {
    expect(checkMintScopes(['workspaces:manage'], [...caller, 'workspaces:manage'])).toMatchObject({ ok: false, status: 403 })
  })

  it('never lets a minted key carry keys:manage, even if the caller has it', () => {
    expect(checkMintScopes(['keys:manage'], caller)).toMatchObject({ ok: false, status: 403 })
  })
  it('rejects unknown, empty or non-array scopes', () => {
    expect(checkMintScopes(['nope'], caller)).toMatchObject({ ok: false, status: 400 })
    expect(checkMintScopes([], caller)).toMatchObject({ ok: false, status: 400 })
    expect(checkMintScopes('contacts:read', caller)).toMatchObject({ ok: false, status: 400 })
  })
})
