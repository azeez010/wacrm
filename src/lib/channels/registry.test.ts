import { describe, expect, it } from 'vitest'
import { CHANNELS, CHANNEL_IDS, channelCapabilities, channelOf, isChannelId } from './registry'

describe('channel registry', () => {
  it('has a definition for every id', () => {
    for (const id of CHANNEL_IDS) expect(CHANNELS[id].id).toBe(id)
  })
  it('treats rows without a channel (pre-086) as WhatsApp', () => {
    expect(channelOf({})).toBe('whatsapp')
    expect(channelOf({ channel: null })).toBe('whatsapp')
    expect(channelOf({ channel: 'carrier_pigeon' })).toBe('whatsapp')
    expect(channelOf({ channel: 'web_chat' })).toBe('web_chat')
    expect(channelOf(undefined)).toBe('whatsapp')
  })
  it('validates ids', () => {
    expect(isChannelId('web_chat')).toBe(true)
    expect(isChannelId('sms')).toBe(false)
    expect(isChannelId(undefined)).toBe(false)
  })
  it('WhatsApp has the 24h window and templates; web chat has neither', () => {
    expect(channelCapabilities('whatsapp')).toMatchObject({ templates: true, replyWindowHours: 24, voiceNotes: true })
    expect(channelCapabilities({ channel: 'web_chat' })).toMatchObject({ templates: false, replyWindowHours: null, voiceNotes: false })
    expect(channelCapabilities({ channel: 'web_chat' }).mediaKinds).toEqual(['image'])
  })
})
