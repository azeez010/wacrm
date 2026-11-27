// Access presets for API keys (what a key may do), shared by the key dialog and the list.
import type { ApiScope } from './scopes'

export const READ_SCOPES: ApiScope[] = [
  'contacts:read',
  'conversations:read',
  'messages:read',
  'templates:read',
  'pipelines:read',
  'automations:read',
  'flows:read',
  'fields:read',
  'tables:read',
  'segments:read',
  'forms:read',
  'ai:read',
  'workspace:read',
]

export const BUILDER_SCOPES: ApiScope[] = [
  ...READ_SCOPES,
  'pipelines:write',
  'automations:write',
  'flows:write',
  'templates:write',
  'fields:write',
  'tables:write',
  'segments:write',
  'forms:manage',
  'ai:write',
]

/** Builder plus what an app integration needs: outbound webhooks and verification codes (OTP). */
export const DEVELOPER_SCOPES: ApiScope[] = [...BUILDER_SCOPES, 'webhooks:manage', 'otp:send', 'otp:verify']

export const FULL_SCOPES: ApiScope[] = [
  ...DEVELOPER_SCOPES,
  'contacts:write',
  'conversations:write',
  'messages:send',
  'broadcasts:send',
  'forms:write',
  'workspace:manage',
  'workspaces:manage',
]

export type PresetId = 'read' | 'builder' | 'developer' | 'full'

export const PRESET_SCOPES: Record<PresetId, ApiScope[]> = { read: READ_SCOPES, builder: BUILDER_SCOPES, developer: DEVELOPER_SCOPES, full: FULL_SCOPES }

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && b.every((s) => a.includes(s))

/** Which preset a key's scopes equal exactly, or 'custom'. */
export function presetFor(scopes: readonly string[]): PresetId | 'custom' {
  for (const id of ['read', 'builder', 'developer', 'full'] as const) if (same(scopes, PRESET_SCOPES[id])) return id
  return 'custom'
}
