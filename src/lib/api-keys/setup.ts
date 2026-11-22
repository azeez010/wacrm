// Copy-paste setup text for connecting a client to OgaDesk. Pure.

export const CLIENTS = ['url', 'claudecode', 'claudedesktop', 'rest'] as const
export type SetupClient = (typeof CLIENTS)[number]

export const KEY_PLACEHOLDER = 'YOUR_API_KEY'

export interface SetupBlock {
  /** i18n key suffix for the block's label. */
  label: 'connectUrl' | 'serverUrl' | 'terminal' | 'configFile' | 'curl'
  value: string
}

/** The blocks to show for one client. `origin` is the site root. */
export function buildSetup(origin: string, key: string | null, client: SetupClient): SetupBlock[] {
  const k = key || KEY_PLACEHOLDER
  const mcp = `${origin}/api/mcp`
  switch (client) {
    case 'url':
      // One URL, nothing else: the key rides in the address so the app needs no sign-in or headers.
      return [{ label: 'connectUrl', value: `${mcp}?key=${k}` }]
    case 'claudecode':
      return [{ label: 'terminal', value: `claude mcp add --transport http ogadesk ${mcp} \\\n  --header "X-API-Key: ${k}"` }]
    case 'claudedesktop':
      return [
        {
          label: 'configFile',
          value: JSON.stringify({ mcpServers: { ogadesk: { command: 'npx', args: ['-y', 'mcp-remote', mcp, '--header', `X-API-Key: ${k}`] } } }, null, 2),
        },
      ]
    case 'rest':
      return [
        { label: 'serverUrl', value: `${origin}/api/v1` },
        { label: 'curl', value: `curl ${origin}/api/v1/me \\\n  -H "X-API-Key: ${k}"` },
      ]
  }
}
