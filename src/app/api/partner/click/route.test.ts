import { describe, expect, it, vi } from 'vitest'

const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({ rpc }) }))
const { POST } = await import('./route')
const post = (body: unknown) => POST(new Request('https://x.test', { method: 'POST', body: JSON.stringify(body) }))

describe('POST /api/partner/click', () => {
  it('counts a valid code (normalised) and ignores junk', async () => {
    expect((await post({ code: 'amaka1' })).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('partner_click', { p_code: 'AMAKA1' })
    rpc.mockClear()
    await post({ code: '!!' })
    await post({})
    expect(rpc).not.toHaveBeenCalled()
  })
})
