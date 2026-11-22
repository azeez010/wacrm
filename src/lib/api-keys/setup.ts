// Copy-paste setup text for connecting a client to OgaDesk. Pure.

export const CLIENTS = ['claudeai', 'claudecode', 'claudedesktop', 'cursor', 'rest'] as const
export type SetupClient = (typeof CLIENTS)[number]

export const KEY_PLACEHOLDER = 'YOUR_API_KEY'

export interface SetupBlock {
  /** i18n key suffix for the block's label. */
  label: 'serverUrl' | 'headerName' | 'headerValue' | 'terminal' | 'configFile' | 'curl'
  value: string
}

/** The blocks to show for one client. `url` is the MCP endpoint; `origin` the site root. */
export function buildSetup(origin: string, key: string | null, client: SetupClient): SetupBlock[] {
  const k = key || KEY_PLACEHOLDER
  const mcp = `${origin}/api/mcp`
  switch (client) {
    case 'claudeai':
      return [
        { label: 'serverUrl', value: mcp },
        { label: 'headerName', value: 'X-API-Key' },
        { label: 'headerValue', value: k },
      ]
    case 'claudecode':
      return [{ label: 'terminal', value: `claude mcp add --transport http ogadesk ${mcp} \\\n  --header "X-API-Key: ${k}"` }]
    case 'claudedesktop':
      return [
        {
          label: 'configFile',
          value: JSON.stringify({ mcpServers: { ogadesk: { command: 'npx', args: ['-y', 'mcp-remote', mcp, '--header', `X-API-Key: ${k}`] } } }, null, 2),
        },
      ]
    case 'cursor':
      return [
        { label: 'serverUrl', value: mcp },
        { label: 'configFile', value: JSON.stringify({ mcpServers: { ogadesk: { url: mcp, headers: { 'X-API-Key': k } } } }, null, 2) },
      ]
    case 'rest':
      return [
        { label: 'serverUrl', value: `${origin}/api/v1` },
        { label: 'curl', value: `curl ${origin}/api/v1/me \\\n  -H "X-API-Key: ${k}"` },
      ]
  }
}
