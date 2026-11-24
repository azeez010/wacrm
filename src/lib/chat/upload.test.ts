import { describe, expect, it } from 'vitest'
import { CHAT_IMAGE_MAX_BYTES, checkChatImage, chatImagePath, sniffImageType } from './upload'

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
const gif = new Uint8Array([...Buffer.from('GIF89a'), 1, 0])
const webp = new Uint8Array([...Buffer.from('RIFF'), 1, 2, 3, 4, ...Buffer.from('WEBP'), 0])
const svg = new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))
const html = new Uint8Array(Buffer.from('<html><script>x</script></html>'))

describe('sniffImageType', () => {
  it('recognises the four allowed formats by their bytes', () => {
    expect(sniffImageType(png)).toBe('image/png')
    expect(sniffImageType(jpg)).toBe('image/jpeg')
    expect(sniffImageType(gif)).toBe('image/gif')
    expect(sniffImageType(webp)).toBe('image/webp')
  })
  it('rejects SVG, HTML, an exe and truncated headers however they are named', () => {
    expect(sniffImageType(svg)).toBeNull()
    expect(sniffImageType(html)).toBeNull()
    expect(sniffImageType(new Uint8Array([0x4d, 0x5a, 0x90, 0]))).toBeNull()
    expect(sniffImageType(new Uint8Array([0x89, 0x50]))).toBeNull()
    expect(sniffImageType(new Uint8Array(0))).toBeNull()
  })
})

describe('checkChatImage', () => {
  it('accepts a real image and derives the extension from the bytes', () => {
    expect(checkChatImage(jpg)).toEqual({ ok: true, type: 'image/jpeg', ext: 'jpg' })
  })
  it('rejects empty, oversize and disguised files', () => {
    expect(checkChatImage(new Uint8Array(0))).toEqual({ ok: false, reason: 'empty' })
    const big = new Uint8Array(CHAT_IMAGE_MAX_BYTES + 1)
    big.set(png)
    expect(checkChatImage(big)).toEqual({ ok: false, reason: 'too_large' })
    expect(checkChatImage(svg)).toEqual({ ok: false, reason: 'unsupported_type' })
  })
})

describe('chatImagePath', () => {
  it('is scoped to the account folder', () => {
    expect(chatImagePath('acc', 'conv', 'png', 'abc')).toBe('account-acc/chat/conv/abc.png')
  })
})
