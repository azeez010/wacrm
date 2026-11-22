import { describe, expect, it } from 'vitest'
import { acceptsMime, kindFromMime, mediaBelongsToAccount, parseMediaValue } from './media'
import { coerceValue, validateFieldOptions } from './coerce'
import { formatFieldValue } from './format'
import { toApiValue } from './contact-values'
import { OPERATORS_BY_KIND } from '@/lib/segments/operators'
import { exportCellValue } from '@/lib/contacts/export-csv'
import type { FieldDef } from './types'

const ACC = '11111111-1111-1111-1111-111111111111'
const path = `account-${ACC}/custom-fields/1700000000-photo.jpg`
const good = {
  url: `https://x.supabase.co/storage/v1/object/public/chat-media/${path}`,
  path,
  name: 'photo.jpg',
  mime: 'image/jpeg',
  size: 120_000,
}
const field = (accept?: 'any' | 'image' | 'document'): FieldDef => ({
  id: 'f',
  key: 'photo',
  field_name: 'Photo',
  field_type: 'media',
  field_options: accept ? { accept } : {},
})

describe('mime helpers', () => {
  it('maps mime to kind and checks accept', () => {
    expect(kindFromMime('image/png')).toBe('image')
    expect(kindFromMime('video/mp4')).toBe('video')
    expect(kindFromMime('audio/ogg')).toBe('audio')
    expect(kindFromMime('application/pdf')).toBe('document')
    expect(acceptsMime(undefined, 'application/pdf')).toBe(true)
    expect(acceptsMime('any', 'application/pdf')).toBe(true)
    expect(acceptsMime('image', 'application/pdf')).toBe(false)
    expect(acceptsMime('document', 'application/pdf')).toBe(true)
  })
})

describe('parseMediaValue', () => {
  it('accepts an object or JSON text and rejects bad shapes', () => {
    expect(parseMediaValue(good)).toMatchObject({ ok: true })
    expect(parseMediaValue(JSON.stringify(good))).toMatchObject({ ok: true })
    expect(parseMediaValue('nope')).toMatchObject({ ok: false })
    expect(parseMediaValue({ ...good, url: 'javascript:alert(1)' })).toMatchObject({ ok: false })
    expect(parseMediaValue({ ...good, path: '../secret' })).toMatchObject({ ok: false })
    expect(parseMediaValue({ ...good, path: 'other/x.jpg' })).toMatchObject({ ok: false })
    expect(parseMediaValue({ ...good, size: 0 })).toMatchObject({ ok: false })
    expect(parseMediaValue({ ...good, mime: 'weird' })).toMatchObject({ ok: false })
  })
})

describe('mediaBelongsToAccount', () => {
  it('requires the account folder and a url that points at that object', () => {
    const v = (parseMediaValue(good) as { ok: true; value: Parameters<typeof mediaBelongsToAccount>[0] }).value
    expect(mediaBelongsToAccount(v, ACC)).toBe(true)
    expect(mediaBelongsToAccount(v, '22222222-2222-2222-2222-222222222222')).toBe(false)
    expect(mediaBelongsToAccount({ ...v, url: 'https://evil.example/other.jpg' }, ACC)).toBe(false)
  })
})

describe('coerceValue (media)', () => {
  it('stores normalised JSON and clears on empty', () => {
    const r = coerceValue(field(), good)
    expect(r).toMatchObject({ ok: true, clear: false })
    expect(JSON.parse((r as { value: { value: string } }).value.value)).toMatchObject({ name: 'photo.jpg' })
    expect(coerceValue(field(), '')).toEqual({ ok: true, clear: true })
  })
  it('enforces accept, size caps and the account guard', () => {
    expect(coerceValue(field('document'), good)).toMatchObject({ ok: false })
    expect(coerceValue(field('image'), good)).toMatchObject({ ok: true })
    expect(coerceValue(field(), { ...good, size: 6 * 1024 * 1024 })).toMatchObject({ ok: false }) // image cap 5 MiB
    expect(coerceValue(field(), good, { accountId: ACC })).toMatchObject({ ok: true })
    expect(coerceValue(field(), good, { accountId: '22222222-2222-2222-2222-222222222222' })).toMatchObject({ ok: false })
  })
  it('validates the accept option', () => {
    expect(validateFieldOptions('media', { accept: 'image' })).toEqual({ ok: true })
    expect(validateFieldOptions('media', {})).toEqual({ ok: true })
    expect(validateFieldOptions('media', { accept: 'pdf' })).toMatchObject({ ok: false })
  })
})

describe('media in display, API, export and filters', () => {
  const text = JSON.stringify(good)
  it('formats as the file name, exposes a typed API value, exports the url', () => {
    expect(formatFieldValue({ field_type: 'media' }, text)).toBe('photo.jpg')
    expect(formatFieldValue({ field_type: 'media' }, 'garbage')).toBe('')
    expect(toApiValue({ field_type: 'media' }, text)).toEqual({
      url: good.url,
      name: 'photo.jpg',
      mime: 'image/jpeg',
      size: 120000,
    })
    expect(exportCellValue({ field_type: 'media' }, text)).toBe(good.url)
  })
  it('can only be filtered by presence', () => {
    expect(OPERATORS_BY_KIND.media).toEqual(['is_empty', 'is_set'])
  })
})
